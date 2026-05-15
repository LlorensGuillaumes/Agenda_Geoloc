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

export const POLLING_TASK = 'agenda.location-polling-task';
const POLLING_PREFIX = 'polling:';
const KEEPALIVE_KEY = 'keepalive:active';

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const LOCATION_INTERVAL_MS = 30 * 1000;

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

async function removePollingEntry(alarmId: string): Promise<void> {
  await AsyncStorage.removeItem(`${POLLING_PREFIX}${alarmId}`);
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
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) return;
  await Location.startLocationUpdatesAsync(POLLING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LOCATION_INTERVAL_MS,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: false,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Agenda',
      notificationBody,
      notificationColor: '#2563EB',
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
  const pollingKeys = keys.filter((k) => k.startsWith(POLLING_PREFIX));
  if (pollingKeys.length > 0) await AsyncStorage.multiRemove(pollingKeys);
  await AsyncStorage.removeItem(KEEPALIVE_KEY);
  await stopLocationTask();
}

type LocationTaskData = { locations: Location.LocationObject[] };

TaskManager.defineTask<LocationTaskData>(POLLING_TASK, async ({ data, error }) => {
  if (error) return;
  if (!data?.locations || data.locations.length === 0) return;
  const last = data.locations[data.locations.length - 1];
  const cur: LatLng = {
    latitude: last.coords.latitude,
    longitude: last.coords.longitude,
  };

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
    if (dist <= entry.innerRadius) {
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
  }

  // No paramos el task aquí: el reconcile lo decide. Si hay keepalive activo
  // por alarmas registradas, debemos seguir corriendo.
});
