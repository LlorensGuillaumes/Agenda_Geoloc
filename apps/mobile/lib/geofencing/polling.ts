/**
 * Servicio de location en background.
 *
 * Dos roles unificados en un único `Location.startLocationUpdatesAsync`:
 *
 * 1. **Keepalive** (anti-MIUI): mientras haya al menos una alarma location
 *    activa, el task corre como foreground service con notificación
 *    persistente. Esto evita que MIUI/Xiaomi mate el proceso de la app y
 *    GMS pueda despertar el handler de geofencing cuando hay un cruce real.
 *
 * 2. **Polling de confirmación** (Wikiloc-style): cuando dispara ENTER del
 *    geofence externo, añadimos una entrada `polling:{alarmId}`. En cada
 *    location update, si hay entradas pendientes, comprobamos distancia al
 *    centro y notificamos cuando entran al radio interno.
 *
 * Estado:
 * - `polling:{alarmId}` - entrada de polling pendiente de confirmar
 * - `keepalive:active` - lista de alarmIds que mantienen vivo el service
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotifyConfig } from '../api/client';
import {
  ALARM_ACTIONS_CATEGORY,
  ALARM_CATEGORY,
  ALARM_CHANNEL_ID,
  buildContactData,
} from '../notifications';
import {
  getTestModeEnabled,
  sendTraceBatch,
} from '../testing/traces';
import type { TraceItemInput } from '@agenda/shared';
import { ensureTrackingGeofence, stopTrackingGeofence } from './tracking';

export const POLLING_TASK = 'agenda.location-polling-task';
const POLLING_PREFIX = 'polling:';
const KEEPALIVE_KEY = 'keepalive:active';

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
// Resolució agressiva per debugging: 5s entre updates + accuracy High al
// startLocationTask. Costa bateria, però mentre estem afinant l'algoritme
// preferim veure dades fines a estalviar bateria. Quan acabem el debug,
// això tornarà a 30s + Balanced.
const LOCATION_INTERVAL_MS = 5 * 1000;

type LatLng = { latitude: number; longitude: number };

export type PollingEntry = {
  alarmId: string;
  centerLat: number;
  centerLng: number;
  innerRadius: number;
  event: 'enter' | 'exit' | 'nearby';
  title: string;
  notes: string | null;
  startedAt: number;
  notifyConfig?: NotifyConfig | null;
};

function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

async function readPollingEntries(): Promise<PollingEntry[]> {
  const keys = await AsyncStorage.getAllKeys();
  const pollingKeys = keys.filter((k) => k.startsWith(POLLING_PREFIX));
  if (pollingKeys.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(pollingKeys);
  const entries: PollingEntry[] = [];
  for (const [, raw] of pairs) {
    if (!raw) continue;
    try {
      entries.push(JSON.parse(raw) as PollingEntry);
    } catch {
      // skip
    }
  }
  return entries;
}

const POLLING_LAST_DIST_PREFIX = 'polling-lastdist:';
// Comptador de mostres consecutives "clarament fora" per alarma. Cal
// arribar a OUTSIDE_STREAK_NEEDED abans que una mostra dins compti com
// a cross-in real. Així una sola oscil·lació GPS no enganya.
const OUTSIDE_STREAK_PREFIX = 'polling-outside-streak:';
const OUTSIDE_STREAK_NEEDED = 2;

async function removePollingEntry(alarmId: string): Promise<void> {
  await AsyncStorage.multiRemove([
    `${POLLING_PREFIX}${alarmId}`,
    `${POLLING_LAST_DIST_PREFIX}${alarmId}`,
    `${OUTSIDE_STREAK_PREFIX}${alarmId}`,
  ]);
}

async function readKeepaliveIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEEPALIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function writeKeepaliveIds(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await AsyncStorage.removeItem(KEEPALIVE_KEY);
  } else {
    await AsyncStorage.setItem(KEEPALIVE_KEY, JSON.stringify(ids));
  }
}

async function startLocationTask(notificationBody: string): Promise<void> {
  // El text del foreground service (`notificationBody`) només s'aplica a
  // l'arrencada. Si el service ja corria amb un altre nombre d'alarmes,
  // aturem-lo i tornem a arrencar perquè el comptador "Vigilant N llocs"
  // quedi actualitzat. El cost és baix: només passa quan l'usuari crea/
  // esborra alarmes.
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) {
    await Location.stopLocationUpdatesAsync(POLLING_TASK).catch(() => {});
  }
  await Location.startLocationUpdatesAsync(POLLING_TASK, {
    accuracy: Location.Accuracy.High,
    // `timeInterval`: máximo cada 30s parado. `distanceInterval: 100` pide
    // un update extra cada 100m recorridos; a 120 km/h eso son ~3s, así que
    // recibimos updates muy frecuentes en carretera sin gastar batería
    // cuando estamos parados.
    timeInterval: LOCATION_INTERVAL_MS,
    distanceInterval: 100,
    showsBackgroundLocationIndicator: false,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Agenda',
      notificationBody,
      notificationColor: '#2563EB',
      killServiceOnDestroy: false,
    },
  });
}

async function stopLocationTask(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) await Location.stopLocationUpdatesAsync(POLLING_TASK);
}

/**
 * Reconcilia el estado del location task con el estado deseado.
 * - Si hay keepalive O polling: arranca (si no estaba).
 * - Si no hay nada: para (si estaba).
 *
 * Cambiar el texto de la notificación del foreground service requiere
 * stop+start, por eso preferimos un texto único informativo.
 */
async function reconcileLocationTask(): Promise<void> {
  const keepaliveIds = await readKeepaliveIds();
  const pollingEntries = await readPollingEntries();
  const shouldRun = keepaliveIds.length > 0 || pollingEntries.length > 0;
  if (shouldRun) {
    const placesCount = keepaliveIds.length;
    const body =
      placesCount > 0
        ? `Vigilando ${placesCount} ${placesCount === 1 ? 'lugar' : 'lugares'} para alarmas`
        : 'Confirmando ubicación cercana a un lugar guardado';
    await startLocationTask(body);
  } else {
    await stopLocationTask();
    // Sense alarmes a vigilar, tampoc necessitem la tracking geofence:
    // no aportaria res i consumiria una geofence slot.
    await stopTrackingGeofence();
  }
}

/**
 * Marca la lista de alarmas que deben mantener el service vivo. Se llama desde
 * `syncGeofences` con la lista de IDs de alarmas location activas.
 */
export async function setKeepaliveAlarms(alarmIds: string[]): Promise<void> {
  await writeKeepaliveIds(alarmIds);
  await reconcileLocationTask();
}

/**
 * Rescat idempotent: si hi ha alarmes a vigilar però el location task no està
 * arrencat (típic després d'un kill agressiu de MIUI), l'arrenca. Si ja està
 * corrent, no fa res. Pensat per cridar-se des de:
 *   - El handler del GEOFENCE_TASK (despertat per GMS quan creua una zona)
 *   - L'app focus a (tabs)/_layout
 *
 * Retorna `true` si ha rescatat el task, `false` si no calia.
 */
export async function ensureLocationTaskRunning(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const keepaliveIds = await readKeepaliveIds();
  const pollingEntries = await readPollingEntries();
  const shouldRun = keepaliveIds.length > 0 || pollingEntries.length > 0;
  if (!shouldRun) return false;
  let running = false;
  try {
    running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  } catch {
    running = false;
  }
  if (running) return false;
  const placesCount = keepaliveIds.length;
  const body =
    placesCount > 0
      ? `Vigilando ${placesCount} ${placesCount === 1 ? 'lugar' : 'lugares'} para alarmas`
      : 'Confirmando ubicación cercana a un lugar guardado';
  await startLocationTask(body);
  return true;
}

/**
 * Añade un polling de confirmación para una alarma. Idempotente: si ya hay
 * uno activo para la misma alarma, lo sobreescribe.
 */
export async function startConfirmation(
  entry: Omit<PollingEntry, 'startedAt'>,
): Promise<void> {
  const full: PollingEntry = { ...entry, startedAt: Date.now() };
  await AsyncStorage.setItem(
    `${POLLING_PREFIX}${entry.alarmId}`,
    JSON.stringify(full),
  );
  await reconcileLocationTask();
}

/**
 * Cancela el polling de confirmación. Idempotente. Si no queda nada activo,
 * para el service.
 */
export async function cancelConfirmation(alarmId: string): Promise<void> {
  await removePollingEntry(alarmId);
  await reconcileLocationTask();
}

/**
 * Limpia todo (polling + keepalive) y para el service. Llamar al logout.
 */
export async function clearAllPolling(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter(
    (k) =>
      k.startsWith(POLLING_PREFIX) ||
      k.startsWith(PROACTIVE_DIST_PREFIX) ||
      k.startsWith(POLLING_LAST_DIST_PREFIX) ||
      k.startsWith(OUTSIDE_STREAK_PREFIX) ||
      k.startsWith('proactive-outside-streak:'),
  );
  if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  await AsyncStorage.removeItem(KEEPALIVE_KEY);
  await stopLocationTask();
  await stopTrackingGeofence();
}

// Cache de geofence guardado por `syncGeofences` para cada alarma. Definimos
// el tipo aquí para no importar de `./index.ts` (causaría ciclo). Debe
// coincidir con `CachedAlarmInfo` de index.ts.
type GeofenceCache = {
  title: string;
  notes: string | null;
  event: 'enter' | 'exit' | 'nearby';
  centerLat: number;
  centerLng: number;
  outerRadius: number;
  repeat?: 'once' | 'always';
  activeWindow?: {
    start: string;
    end: string;
    weekdays?: number[];
  };
  notifyConfig?: NotifyConfig | null;
};

const GEOFENCE_CACHE_PREFIX = 'geofence:';
const PROACTIVE_INNER_RATIO = 0.3;
const PROACTIVE_INNER_MIN = 25;
// Cache de la última distancia conocida por alarmId, para detectar
// transiciones (de fuera a dentro) en lugar de disparar cada vez que estás
// dentro.
const PROACTIVE_DIST_PREFIX = 'proactive-lastdist:';

async function readGeofenceCache(alarmId: string): Promise<GeofenceCache | null> {
  try {
    const raw = await AsyncStorage.getItem(`${GEOFENCE_CACHE_PREFIX}${alarmId}`);
    return raw ? (JSON.parse(raw) as GeofenceCache) : null;
  } catch {
    return null;
  }
}

function isInsideActiveWindow(
  window: NonNullable<GeofenceCache['activeWindow']>,
  now: Date = new Date(),
): boolean {
  if (window.weekdays && window.weekdays.length > 0) {
    if (!window.weekdays.includes(now.getDay())) return false;
  }
  const [sh, sm] = window.start.split(':').map(Number);
  const [eh, em] = window.end.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

async function fireProactiveNotification(
  alarmId: string,
  info: GeofenceCache,
  eventType: 'nearby' | 'enter' | 'exit',
): Promise<void> {
  const contactData = buildContactData(info.notifyConfig);
  const hasActions = (info.notifyConfig?.actions?.length ?? 0) > 0;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: info.title,
      body: info.notes ?? '',
      data: {
        alarmId,
        eventType,
        proactive: true,
        ...(contactData ?? {}),
      },
      categoryIdentifier: hasActions ? ALARM_ACTIONS_CATEGORY : ALARM_CATEGORY,
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
  });
}

type LocationTaskData = { locations: Location.LocationObject[] };

// Si el GPS reporta una accuracy pitjor que això, la posició és tan
// imprecisa que pot oscil·lar fora i dins d'un cercle petit per error.
// Ignorem aquests updates a tots els efectes (no actualitzem lastDist
// ni intentem disparar). Per a radis grans (>200m) ja no importa tant,
// però filtrar és igualment defensiu.
const MAX_ACCURACY_M = 50;

TaskManager.defineTask<LocationTaskData>(POLLING_TASK, async ({ data, error }) => {
  if (error) return;
  if (!data?.locations || data.locations.length === 0) return;
  const last = data.locations[data.locations.length - 1];
  const accuracy = last.coords.accuracy ?? 999;
  const testModeEnabled = await getTestModeEnabled();
  const traceBuffer: TraceItemInput[] = [];
  const tsISO = new Date().toISOString();
  const cur: LatLng = {
    latitude: last.coords.latitude,
    longitude: last.coords.longitude,
  };
  const lowAccuracy = accuracy > MAX_ACCURACY_M;

  // Tracking geofence: només la registrem si no hi ha cap activa. La
  // deixem en repòs perquè GMS tingui temps de detectar EXIT (necessita
  // 30-90s de calibratge). Quan dispari, el seu handler netejarà el centre
  // i la pròxima mostra establirà una de nova al nou punt.
  if (!lowAccuracy) {
    ensureTrackingGeofence(cur.latitude, cur.longitude).catch(() => {});
  }

  // Emet heartbeat de TOTES les keepalive alarms abans del filtre d'accuracy
  // — així podem inspeccionar a la BD també les mostres descartades i veure
  // què veu el dispositiu en cada cas.
  if (testModeEnabled) {
    const keepaliveForHeartbeat = await readKeepaliveIds();
    if (keepaliveForHeartbeat.length > 0) {
      const heartbeat: TraceItemInput[] = [];
      for (const alarmId of keepaliveForHeartbeat) {
        const info = await readGeofenceCache(alarmId);
        if (!info) continue;
        const dist = distanceMeters(cur, {
          latitude: info.centerLat,
          longitude: info.centerLng,
        });
        heartbeat.push({
          ts: tsISO,
          lat: cur.latitude,
          lng: cur.longitude,
          accuracy,
          alarmId,
          alarmTitle: info.title,
          alarmEvent: info.event,
          alarmRepeat: info.repeat ?? 'once',
          outerRadius: info.outerRadius,
          distance: Math.round(dist),
          insideOuter: dist <= info.outerRadius,
          lastDistance: null,
          outsideStreak: null,
          didFire: false,
          source: lowAccuracy ? 'heartbeat-lowacc' : 'heartbeat',
          note: lowAccuracy
            ? `accuracy ${Math.round(accuracy)}m > ${MAX_ACCURACY_M}m (sample skipped)`
            : null,
        });
      }
      if (heartbeat.length > 0) sendTraceBatch(heartbeat);
    } else {
      sendTraceBatch([
        {
          ts: tsISO,
          lat: cur.latitude,
          lng: cur.longitude,
          accuracy,
          source: 'heartbeat-no-alarms',
          didFire: false,
          note: 'no keepalive alarms',
        },
      ]);
    }
  }

  if (lowAccuracy) return;

  // Procesar pollings de confirmación pendientes
  const entries = await readPollingEntries();
  const now = Date.now();
  for (const entry of entries) {
    const expired = now - entry.startedAt > CONFIRM_TIMEOUT_MS;
    if (expired) {
      await removePollingEntry(entry.alarmId);
      continue;
    }
    const dist = distanceMeters(cur, {
      latitude: entry.centerLat,
      longitude: entry.centerLng,
    });

    // Edge detection: guardem la dist anterior i només disparem en la
    // transició fora→dins. Si l'usuari estava ja dins quan es va iniciar
    // el polling (cas típic: registrar la geofence estant a casa, GMS
    // dispara un ENTER artificial), la primera mostra NO dispara. Hem
    // d'esperar que es separi prou per després tornar a entrar.
    const lastKey = `${POLLING_LAST_DIST_PREFIX}${entry.alarmId}`;
    const lastRaw = await AsyncStorage.getItem(lastKey);
    const lastDist = lastRaw ? Number(lastRaw) : null;
    await AsyncStorage.setItem(lastKey, String(Math.round(dist)));

    // Per evitar falsos cross-in causats per oscil·lacions del GPS
    // (especialment a interiors, on pot saltar 30m amunt i avall), exigim
    // dues mostres consecutives "clarament fora" abans que una mostra "dins"
    // compti com una arribada real. Així una sola lectura GPS dolenta no
    // simula una sortida + tornada.
    const REQUIRED_EXIT_MARGIN_M = 30;
    const streakKey = `${OUTSIDE_STREAK_PREFIX}${entry.alarmId}`;
    const streakRaw = await AsyncStorage.getItem(streakKey);
    let outsideStreak = streakRaw ? Number(streakRaw) : 0;

    const inside = dist <= entry.innerRadius;
    const clearlyOutside = dist > entry.innerRadius + REQUIRED_EXIT_MARGIN_M;

    if (clearlyOutside) {
      outsideStreak += 1;
      await AsyncStorage.setItem(streakKey, String(outsideStreak));
      continue;
    }

    if (!inside) {
      // Zona buffer entre triggerDist i triggerDist+margin: no resetejem
      // el streak (l'usuari pot estar caminant prop del límit).
      continue;
    }

    // dist <= innerRadius. Només dispara si el streak ha arribat al mínim.
    if (outsideStreak < OUTSIDE_STREAK_NEEDED) continue;
    // Reset streak abans de disparar; el polling es retira tot seguit.
    await AsyncStorage.removeItem(streakKey);

    const contactData = buildContactData(entry.notifyConfig);
    const hasActions = (entry.notifyConfig?.actions?.length ?? 0) > 0;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: entry.title,
        body: entry.notes ?? '',
        data: {
          alarmId: entry.alarmId,
          eventType: 'enter',
          confirmed: true,
          ...(contactData ?? {}),
        },
        categoryIdentifier: hasActions ? ALARM_ACTIONS_CATEGORY : ALARM_CATEGORY,
        sound: 'default',
      },
      trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
    });
    await removePollingEntry(entry.alarmId);
    // Notificar al sistema de "fire-and-deactivate". El import dinámico
    // evita ciclo de imports entre polling.ts y index.ts.
    try {
      const mod = await import('./fired');
      await mod.markAlarmFiredIfOnce(entry.alarmId);
    } catch {
      // ignore
    }
  }

  // Detección proactiva: el geofence nativo de Android es muy lento a alta
  // velocidad (puede no detectar un cruce de 200m a 120 km/h). Aprovechamos
  // los location updates que ya recibimos para comprobar nosotros mismos la
  // distancia a cada geofence "nearby" o "enter" activo y disparar antes.
  //
  // Reglas:
  // - 'nearby': dispara si dist <= outerRadius
  // - 'enter':  dispara si dist <= innerRadius (mismo cálculo que index.ts)
  // - 'exit':   no nos metemos — el exit nativo ya es fiable
  // - Solo aplicamos a repeat='once' para evitar duplicados consecutivos en
  //   'always' (esos siguen vía GMS, que ya hace dedupe por estado interno).
  // - Si hay un polling de confirmación activo para el alarmId (event='enter'),
  //   no duplicamos — el polling ya está procesado arriba.
  const keepaliveIds = await readKeepaliveIds();
  if (keepaliveIds.length > 0) {
    let firedMod: typeof import('./fired') | null = null;
    try {
      firedMod = await import('./fired');
    } catch {
      // Si no podemos cargar el módulo `fired`, mejor no disparar
      // proactivamente — el flag local es clave para evitar duplicados.
      firedMod = null;
    }
    if (firedMod) {
      for (const alarmId of keepaliveIds) {
        if (await firedMod.isAlarmFired(alarmId)) continue;
        const info = await readGeofenceCache(alarmId);
        if (!info) continue;

        // Branca exit proactiu: si GMS no entrega l'EXIT natiu (típic a
        // Xiaomi quan el procés ha estat mort i ressuscitat), aprofitem el
        // polling per disparar. Cal streak per evitar oscil·lacions GPS, i
        // "wasInside" perquè no dispari si l'alarma es crea estant ja fora.
        if (info.event === 'exit') {
          if (info.activeWindow && !isInsideActiveWindow(info.activeWindow)) {
            continue;
          }
          if (info.repeat === 'always') {
            const recentKey = `recent-fired:${alarmId}:exit`;
            const recentRaw = await AsyncStorage.getItem(recentKey);
            if (recentRaw) {
              const ts = Number(recentRaw);
              if (Number.isFinite(ts) && Date.now() - ts < 60_000) {
                // Bloquejat però estenem el timer (sliding window) per
                // absorbir oscil·lacions llargues.
                await AsyncStorage.setItem(recentKey, String(Date.now())).catch(() => {});
                continue;
              }
            }
          }

          const dist = distanceMeters(cur, {
            latitude: info.centerLat,
            longitude: info.centerLng,
          });
          const EXIT_OUTSIDE_MARGIN_M = 30;
          const wasInsideKey = `exit-was-inside:${alarmId}`;
          const exitStreakKey = `exit-outside-streak:${alarmId}`;
          const clearlyInside = dist <= info.outerRadius - 10;
          const clearlyOutside =
            dist > info.outerRadius + EXIT_OUTSIDE_MARGIN_M;

          const traceBaseExit: TraceItemInput = {
            ts: tsISO,
            lat: cur.latitude,
            lng: cur.longitude,
            accuracy,
            alarmId,
            alarmTitle: info.title,
            alarmEvent: 'exit',
            alarmRepeat: info.repeat ?? 'once',
            outerRadius: info.outerRadius,
            distance: Math.round(dist),
            insideOuter: dist <= info.outerRadius,
            lastDistance: null,
            outsideStreak: null,
            didFire: false,
            source: 'proactive-exit',
            note: null,
          };

          if (clearlyInside) {
            await AsyncStorage.setItem(wasInsideKey, '1');
            await AsyncStorage.removeItem(exitStreakKey);
            continue;
          }

          if (!clearlyOutside) {
            if (testModeEnabled) {
              traceBuffer.push({ ...traceBaseExit, note: 'exit buffer zone' });
            }
            continue;
          }

          const wasInside = await AsyncStorage.getItem(wasInsideKey);
          if (!wasInside) {
            if (testModeEnabled) {
              traceBuffer.push({
                ...traceBaseExit,
                note: 'outside but never seen inside',
              });
            }
            continue;
          }

          const streakRaw = await AsyncStorage.getItem(exitStreakKey);
          let exitStreak = streakRaw ? Number(streakRaw) : 0;
          exitStreak += 1;
          await AsyncStorage.setItem(exitStreakKey, String(exitStreak));

          if (exitStreak < OUTSIDE_STREAK_NEEDED) {
            if (testModeEnabled) {
              traceBuffer.push({
                ...traceBaseExit,
                outsideStreak: exitStreak,
                note: `exit streak ${exitStreak} < ${OUTSIDE_STREAK_NEEDED}`,
              });
            }
            continue;
          }

          await fireProactiveNotification(alarmId, info, 'exit');
          await AsyncStorage.removeItem(exitStreakKey);
          if (info.repeat === 'once') {
            await firedMod.markAlarmFired(alarmId, 'once');
          } else {
            await AsyncStorage.setItem(
              `recent-fired:${alarmId}:exit`,
              String(Date.now()),
            );
          }
          if (testModeEnabled) {
            traceBuffer.push({
              ...traceBaseExit,
              outsideStreak: exitStreak,
              didFire: true,
              note: 'FIRED (proactive-exit)',
            });
          }
          continue;
        }

        if (info.repeat === 'always') continue;
        if (info.activeWindow && !isInsideActiveWindow(info.activeWindow)) continue;
        // NOTA: NO saltem aquí si hi ha polling de confirmació actiu. Si la
        // proactive ja té streak suficient (l'usuari realment va sortir i
        // torna), la cross-in és real i hem de disparar encara que GMS hagi
        // iniciat un polling al detectar ENTER natiu. Si no, en el moment
        // FIRE més avall netegem la entry de polling per evitar duplicats.

        const dist = distanceMeters(cur, {
          latitude: info.centerLat,
          longitude: info.centerLng,
        });
        const innerRadius = Math.max(
          PROACTIVE_INNER_MIN,
          Math.round(info.outerRadius * PROACTIVE_INNER_RATIO),
        );
        // El trigger no pot ser més gran que el radi extern. Si l'usuari
        // configura un radi petit (p.ex. 20m) i l'inner per defecte (25m)
        // queda més gran, dispararíem fora del cercle real → ho limitem.
        const triggerDist =
          info.event === 'nearby'
            ? info.outerRadius
            : Math.min(info.outerRadius, innerRadius);

        // Edge-detection: només disparem en transició "fora → dins". Llegim
        // la última distància coneguda. Si no n'hi havia (primera execució
        // amb aquesta alarma a la cache), guardem la actual i NO disparem
        // — així evitem el cas "l'usuari activa l'alarma estant ja dins".
        const lastDistRaw = await AsyncStorage.getItem(
          `${PROACTIVE_DIST_PREFIX}${alarmId}`,
        );
        const lastDist = lastDistRaw ? Number(lastDistRaw) : null;
        await AsyncStorage.setItem(
          `${PROACTIVE_DIST_PREFIX}${alarmId}`,
          String(Math.round(dist)),
        );

        // Mateixa lògica anti-oscil·lació que el polling de confirmació:
        // cal acumular dues mostres consecutives "clarament fora" abans
        // que una mostra "dins" compti com a cross-in.
        const PROACTIVE_EXIT_MARGIN_M = 30;
        const proactiveStreakKey = `proactive-outside-streak:${alarmId}`;
        const proactiveStreakRaw = await AsyncStorage.getItem(proactiveStreakKey);
        let proactiveStreak = proactiveStreakRaw ? Number(proactiveStreakRaw) : 0;

        const clearlyOutsideProactive = dist > triggerDist + PROACTIVE_EXIT_MARGIN_M;
        const traceBase: TraceItemInput = {
          ts: tsISO,
          lat: cur.latitude,
          lng: cur.longitude,
          accuracy,
          alarmId,
          alarmTitle: info.title,
          alarmEvent: info.event,
          alarmRepeat: info.repeat ?? 'once',
          outerRadius: info.outerRadius,
          distance: Math.round(dist),
          insideOuter: dist <= info.outerRadius,
          lastDistance: lastDist === null ? null : Math.round(lastDist),
          outsideStreak: proactiveStreak,
          didFire: false,
          source: 'proactive',
          note: null,
        };
        if (clearlyOutsideProactive) {
          proactiveStreak += 1;
          await AsyncStorage.setItem(proactiveStreakKey, String(proactiveStreak));
          if (testModeEnabled) {
            traceBuffer.push({
              ...traceBase,
              outsideStreak: proactiveStreak,
              note: 'clearly outside, streak++',
            });
          }
          continue;
        }
        // Si encara estem clarament fora del trigger circle, no és cross-in.
        if (dist > triggerDist) {
          if (testModeEnabled) {
            traceBuffer.push({ ...traceBase, note: 'buffer zone (no fire)' });
          }
          continue;
        }
        // Som dins del trigger circle. Si tenim streak suficient → FIRE,
        // sigui clarament dins o a la franja de buffer. Comprovem això
        // ABANS de cap reset perquè una tornada ràpida (de 70m a 7m entre
        // dues mostres) podria saltar-se la franja intermèdia i passar
        // directament al "clearly inside" — perdríem el fire.
        if (proactiveStreak < OUTSIDE_STREAK_NEEDED) {
          // Streak baix: si estem clarament dins, neteja el legacy d'una
          // oscil·lació puntual o sortida anterior incompleta. Si no,
          // simplement no disparem encara.
          const clearlyInsideProactive = dist < Math.max(0, triggerDist - 10);
          if (clearlyInsideProactive && proactiveStreak > 0) {
            await AsyncStorage.removeItem(proactiveStreakKey);
            if (testModeEnabled) {
              traceBuffer.push({
                ...traceBase,
                outsideStreak: 0,
                note: 'clearly inside, streak reset',
              });
            }
          } else if (testModeEnabled) {
            traceBuffer.push({
              ...traceBase,
              note: `inside but streak ${proactiveStreak} < ${OUTSIDE_STREAK_NEEDED}`,
            });
          }
          continue;
        }
        await AsyncStorage.removeItem(proactiveStreakKey);
        // Neteja qualsevol polling de confirmació pendent — la proactive ja
        // ha disparat, no volem que Path 1 hi torni més tard amb duplicat.
        await removePollingEntry(alarmId);

        // Transició fora → dins: dispara
        await fireProactiveNotification(
          alarmId,
          info,
          info.event === 'nearby' ? 'nearby' : 'enter',
        );
        await firedMod.markAlarmFired(alarmId, info.repeat);
        if (testModeEnabled) {
          traceBuffer.push({
            ...traceBase,
            didFire: true,
            note: 'FIRED (proactive)',
          });
        }
      }
    }
  }

  if (testModeEnabled && traceBuffer.length > 0) {
    sendTraceBatch(traceBuffer);
  }

  // No paramos el task aquí: el reconcile lo decide. Si hay keepalive activo
  // por alarmas registradas, debemos seguir corriendo.
});
