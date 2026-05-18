import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Alarm, NotifyConfig, Place } from '../api/client';
import {
  cancelConfirmation,
  clearAllPolling,
  ensureLocationTaskRunning,
  setKeepaliveAlarms,
  startConfirmation,
} from './polling';
import { isTrackingGeofenceActive } from './tracking';
import {
  clearAllFiredFlags,
  isAlarmFired,
  markAlarmFired,
  reconcileFiredFlags,
} from './fired';
import {
  ALARM_ACTIONS_CATEGORY,
  ALARM_CATEGORY,
  ALARM_CHANNEL_ID,
  buildContactData,
} from '../notifications';

export const GEOFENCE_TASK = 'agenda.geofence-task';
const CACHE_PREFIX = 'geofence:';
const IOS_GEOFENCE_LIMIT = 20;

// GMS dispara un ENTER artificial al cridar startGeofencingAsync si l'usuari
// ja és dins de la regió. Marquem el timestamp del registre per descartar els
// ENTER que arriben dins d'aquesta finestra (s'apliquen només als camins de
// fire directe; per `enter+once` el polling+streak ja ho filtra).
const REGISTER_COOLDOWN_KEY = 'geofence-registered-at';
const REGISTER_COOLDOWN_MS = 30 * 1000;

/**
 * Ratio del radio externo del geofence que se considera "centro" para la
 * confirmación con polling. Ej. con radio externo 100m → confirmación a 30m.
 * Mínimo absoluto 25m (por debajo el GPS no diferencia bien).
 */
const INNER_RADIUS_RATIO = 0.3;
const INNER_RADIUS_MIN = 25;

type CachedAlarmInfo = {
  title: string;
  notes: string | null;
  event: 'enter' | 'exit' | 'nearby';
  centerLat: number;
  centerLng: number;
  outerRadius: number;
  repeat?: 'once' | 'always'; // default 'once'
  activeWindow?: {
    start: string; // "HH:MM"
    end: string; // "HH:MM"
    weekdays?: number[]; // 0=domingo, 6=sábado
  };
  notifyConfig?: NotifyConfig | null;
};

/**
 * Comprueba si la fecha indicada cae dentro de la ventana activa.
 *
 * - Si `weekdays` está definido y el día actual no está, devuelve false.
 * - Si `start <= end` (ej. 14:00–22:00): dentro si la hora actual cae dentro
 *   del rango.
 * - Si `start > end` (ej. 22:00–06:00, cruza medianoche): dentro si la hora
 *   actual es >= start o < end.
 */
export function isInsideActiveWindow(
  window: NonNullable<CachedAlarmInfo['activeWindow']>,
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
  // Cruza medianoche
  return cur >= start || cur < end;
}

type GeofenceTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

// Importante: defineTask debe ejecutarse en module-level (no dentro de un
// componente). Importando este módulo desde el root layout garantizamos que
// el handler queda registrado antes del primer render.
TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[geofencing] task error', error);
    return;
  }
  if (!data) return;
  const { eventType, region } = data;
  if (!region?.identifier) return;

  // Rescat: si el procés s'havia mort i ara GMS l'ha despertat, és la
  // millor oportunitat per ressuscitar el location task. Fer-ho aquí garanteix
  // que la primera transició natiu després d'un kill reactiva el polling sense
  // necessitat que l'usuari obri l'app. Idempotent si ja està arrencat.
  ensureLocationTaskRunning().catch(() => {});

  const isEnter = eventType === Location.GeofencingEventType.Enter;

  // Si la alarma ya disparó (repeat='once'), ignorar.
  if (await isAlarmFired(region.identifier)) return;

  let info: CachedAlarmInfo | null = null;
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${region.identifier}`);
    info = raw ? (JSON.parse(raw) as CachedAlarmInfo) : null;
  } catch {
    // Cache lost or corrupted; we still notify with a generic body.
  }

  // Filtrar por evento que el usuario quiere (registramos siempre enter+exit
  // para mantener el estado interno del SO, pero solo notificamos lo pedido).
  const wantedEnter = !info || info.event === 'enter' || info.event === 'nearby';
  const wantedExit = !info || info.event === 'exit';

  // Si el usuario salió del radio externo antes de confirmar el enter,
  // cancelamos el polling silenciosamente (no era el lugar de verdad).
  if (!isEnter) {
    await cancelConfirmation(region.identifier);
  }

  if (isEnter && !wantedEnter) return;
  if (!isEnter && !wantedExit) return;

  // Filtrar por ventana horaria si está definida.
  if (info?.activeWindow && !isInsideActiveWindow(info.activeWindow)) return;

  // Cooldown post-registre: si l'ENTER arriba dins els primers segons després
  // d'un `startGeofencingAsync`, és el ENTER artificial que GMS sempre dispara
  // quan l'usuari ja és dins de la regió al registrar. Filtrar només camins
  // de fire directe — `enter+once` passa pel polling, que ja té edge-detection.
  const goesToPolling = isEnter && info?.event === 'enter' && info.repeat !== 'always';
  if (isEnter && !goesToPolling) {
    try {
      const raw = await AsyncStorage.getItem(REGISTER_COOLDOWN_KEY);
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && Date.now() - ts < REGISTER_COOLDOWN_MS) {
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  // Caminos según evento + repeat:
  //
  // - `event === 'enter'` + `repeat === 'once'`: polling de confirmación al
  //   radio interno (precisión real "estás en el sitio"). La notificación
  //   sale cuando el polling confirma posición; markAlarmFired lo hace
  //   `polling.ts` al confirmar. Importante para evitar que un disparo
  //   prematuro consuma el único trigger de una alarma `once`.
  // - `event === 'enter'` + `repeat === 'always'`: notificación instantánea
  //   al primer ENTER del nativo. Sin polling: como puede dispararse muchas
  //   veces, no compensa esperar precisión — si el GPS oscila al borde, el
  //   polling con radio interno > radio externo puede no confirmar nunca
  //   (caso de radios <25m, donde inner cae fuera del cercle real).
  // - `event === 'nearby'` y entramos: igual, instantánea al outer radius.
  // - `event === 'exit'` y salimos: instantánea.
  if (isEnter && info && info.event === 'enter' && info.repeat !== 'always') {
    const innerRadius = Math.max(
      INNER_RADIUS_MIN,
      Math.round(info.outerRadius * INNER_RADIUS_RATIO),
    );
    await startConfirmation({
      alarmId: region.identifier,
      centerLat: info.centerLat,
      centerLng: info.centerLng,
      innerRadius,
      event: info.event,
      title: info.title,
      notes: info.notes,
      notifyConfig: info.notifyConfig ?? null,
    });
    return;
  }

  // Debounce de 60s: GMS pot disparar el mateix event diverses vegades en
  // pocs segons quan el GPS oscil·la al borde del cercle (típic amb radis
  // petits). Sense aquest filtre, "Surts" pot rebotar fins a saturar les
  // notificacions. Per a `repeat='once'` no cal (el fired flag ja bloqueja);
  // per a `always` sí.
  const recentKey = `recent-fired:${region.identifier}:${isEnter ? 'enter' : 'exit'}`;
  const RECENT_TTL_MS = 60 * 1000;
  try {
    const raw = await AsyncStorage.getItem(recentKey);
    if (raw) {
      const ts = Number(raw);
      if (Number.isFinite(ts) && Date.now() - ts < RECENT_TTL_MS) return;
    }
  } catch {
    // ignore
  }

  const contactData = buildContactData(info?.notifyConfig);
  const hasActions = (info?.notifyConfig?.actions?.length ?? 0) > 0;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: info?.title ?? 'Alarma',
      body: info?.notes ?? '',
      data: {
        alarmId: region.identifier,
        eventType: isEnter ? (info?.event === 'nearby' ? 'nearby' : 'enter') : 'exit',
        ...(contactData ?? {}),
      },
      categoryIdentifier: hasActions ? ALARM_ACTIONS_CATEGORY : ALARM_CATEGORY,
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
  });
  try {
    await AsyncStorage.setItem(recentKey, String(Date.now()));
  } catch {
    // ignore
  }
  // Para 'nearby' (enter directo), 'enter' con 'always' y 'exit' directo:
  // marcar como fired si es de un solo uso. 'enter' con repeat='once' lo
  // gestiona `polling.ts` al confirmar la posición precisa.
  await markAlarmFired(region.identifier, info?.repeat);
});

export type SyncResult = {
  registered: number;
  skipped: number;
  exceededIosLimit: boolean;
};

export async function syncGeofences(input: {
  alarms: Alarm[];
  places: Place[];
}): Promise<SyncResult> {
  const { alarms, places } = input;
  const placeIndex = new Map(places.map((p) => [p.id, p]));

  const candidates: Array<{ region: Location.LocationRegion; cache: CachedAlarmInfo }> = [];
  let skipped = 0;

  for (const alarm of alarms) {
    if (!alarm.isActive) {
      skipped++;
      continue;
    }
    // pending_acceptance: el owner aún no ha aceptado, no registramos.
    if (alarm.status !== 'active') {
      skipped++;
      continue;
    }
    if (alarm.triggerType === 'time') {
      // Pure time alarms use expo-notifications scheduling, not geofencing.
      continue;
    }
    const cfg = alarm.locationConfig;
    if (!cfg) {
      skipped++;
      continue;
    }

    let latitude: number;
    let longitude: number;
    let radius: number;

    if (cfg.mode === 'saved_place') {
      const place = cfg.placeId ? placeIndex.get(cfg.placeId) : undefined;
      if (!place) {
        skipped++;
        continue;
      }
      latitude = place.latitude;
      longitude = place.longitude;
      radius = place.radiusMeters;
    } else if (cfg.mode === 'custom_point' && cfg.customPoint) {
      latitude = cfg.customPoint.latitude;
      longitude = cfg.customPoint.longitude;
      radius = cfg.customPoint.radiusMeters;
    } else {
      skipped++;
      continue;
    }

    // Registramos siempre AMBOS triggers aunque al usuario solo le interese uno.
    // Si solo registras notifyOnEnter, el estado interno del geofence en
    // Google Play Services nunca se actualiza al salir del radio, y al volver
    // a entrar no se detecta cambio de estado → no dispara. Idem al revés.
    // El filtrado por evento deseado se hace en el handler de TaskManager.
    candidates.push({
      region: {
        identifier: alarm.id,
        latitude,
        longitude,
        radius,
        notifyOnEnter: true,
        notifyOnExit: true,
      },
      cache: {
        title: alarm.title,
        notes: alarm.notes,
        event: cfg.event,
        centerLat: latitude,
        centerLng: longitude,
        outerRadius: radius,
        repeat: cfg.repeat,
        activeWindow: cfg.activeWindow,
        notifyConfig: alarm.notifyConfig,
      },
    });
  }

  // iOS solo permite 20 geofences activos por app. Si hay más, dejamos los
  // primeros 20 (orden de creación). Mejora futura: ordenar por proximidad
  // a la ubicación actual.
  const limited = candidates.slice(0, IOS_GEOFENCE_LIMIT);
  const exceededIosLimit = candidates.length > limited.length;

  // Stop and clear before re-registering. Idempotente por si el task no
  // estaba activo.
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (running) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // No running task or no permission. Sigamos.
  }

  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (stale.length > 0) {
      await AsyncStorage.multiRemove(stale);
    }
  } catch {
    // Storage error; el handler usará fallbacks genéricos.
  }

  if (limited.length > 0) {
    await Promise.all(
      limited.map(({ region, cache }) =>
        AsyncStorage.setItem(`${CACHE_PREFIX}${region.identifier}`, JSON.stringify(cache)),
      ),
    );
    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      limited.map((c) => c.region),
    );
    try {
      await AsyncStorage.setItem(REGISTER_COOLDOWN_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  // Mantener el location service vivo mientras haya alarmas activas.
  // Esto crea una notificación persistente "Vigilando N lugares" en Android
  // y evita que MIUI/Xiaomi mate el proceso, garantizando que GMS pueda
  // despertar el handler del geofence cuando hay cruces reales.
  const activeIds = limited
    .map((c) => c.region.identifier)
    .filter((id): id is string => typeof id === 'string');
  await setKeepaliveAlarms(activeIds);

  // Reconcilia los flags `fired` locales: limpia los de alarmas que ya no
  // están activas y reintenta el patch para las que sí siguen activas pero
  // tienen flag fired (probable fallo previo de red).
  await reconcileFiredFlags(new Set(activeIds));

  return {
    registered: limited.length,
    skipped,
    exceededIosLimit,
  };
}

export async function unregisterAllGeofences(): Promise<void> {
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (running) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // ignore
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith(CACHE_PREFIX));
    if (stale.length > 0) {
      await AsyncStorage.multiRemove(stale);
    }
  } catch {
    // ignore
  }
  try {
    await clearAllPolling();
  } catch {
    // ignore
  }
  try {
    await clearAllFiredFlags();
  } catch {
    // ignore
  }
}

export type LocationPermissionState = {
  whenInUse: boolean;
  always: boolean;
  canAskAgainAlways: boolean;
};

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return {
    whenInUse: fg.granted,
    always: bg.granted,
    canAskAgainAlways: bg.canAskAgain,
  };
}

export async function requestLocationPermissions(): Promise<LocationPermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    return { whenInUse: false, always: false, canAskAgainAlways: fg.canAskAgain };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    whenInUse: true,
    always: bg.granted,
    canAskAgainAlways: bg.canAskAgain,
  };
}

export async function isGeofencingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}

/**
 * Estat intern dels serveis per a debugging. Útil quan l'usuari no veu la
 * notificació "Vigilando N lugares" i volem saber si el location task està
 * realment arrencat.
 */
export async function getGeofenceDiagnostic(): Promise<{
  geofenceTaskStarted: boolean;
  locationTaskStarted: boolean;
  trackingTaskStarted: boolean;
  keepaliveCount: number;
  geofenceCacheKeys: number;
}> {
  let geofenceTaskStarted = false;
  let locationTaskStarted = false;
  let trackingTaskStarted = false;
  try {
    geofenceTaskStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // ignore
  }
  try {
    locationTaskStarted = await Location.hasStartedLocationUpdatesAsync(
      'agenda.location-polling-task',
    );
  } catch {
    // ignore
  }
  try {
    trackingTaskStarted = await isTrackingGeofenceActive();
  } catch {
    // ignore
  }
  let keepaliveCount = 0;
  let geofenceCacheKeys = 0;
  try {
    const raw = await AsyncStorage.getItem('keepalive:active');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) keepaliveCount = parsed.length;
    }
    const keys = await AsyncStorage.getAllKeys();
    geofenceCacheKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX)).length;
  } catch {
    // ignore
  }
  return {
    geofenceTaskStarted,
    locationTaskStarted,
    trackingTaskStarted,
    keepaliveCount,
    geofenceCacheKeys,
  };
}
