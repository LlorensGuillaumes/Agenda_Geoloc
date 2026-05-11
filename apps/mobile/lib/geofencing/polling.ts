/**
 * Polling de confirmación tipo Wikiloc.
 *
 * Cuando el geofence amplio (≥100m, requerido por Google Play Services para
 * fiabilidad) detecta ENTER, arrancamos un polling de location cada 30s para
 * confirmar que el usuario realmente está dentro del radio interno (la zona
 * "casa = casa"). Eso permite tener un radio externo fiable + precisión real
 * a coste de batería SOLO cuando estamos cerca.
 *
 * Estado:
 * - `polling:{alarmId}` en AsyncStorage con info del polling activo
 * - El task de location updates corre mientras haya al menos un polling activo
 * - Cada entrada tiene un timeout (5 min) para no quedar polling indefinido si
 *   el usuario pasa cerca pero nunca entra al radio interno
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALARM_CATEGORY, ALARM_CHANNEL_ID } from '../notifications';

export const POLLING_TASK = 'agenda.location-polling-task';
const POLLING_PREFIX = 'polling:';

const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const POLLING_INTERVAL_MS = 30 * 1000;

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

async function readEntries(): Promise<PollingEntry[]> {
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
      // skip corrupt
    }
  }
  return entries;
}

async function removeEntry(alarmId: string): Promise<void> {
  await AsyncStorage.removeItem(`${POLLING_PREFIX}${alarmId}`);
}

async function ensureLocationTaskRunning(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) return;
  await Location.startLocationUpdatesAsync(POLLING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: POLLING_INTERVAL_MS,
    distanceInterval: 0,
    showsBackgroundLocationIndicator: false,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: 'Agenda',
      notificationBody: 'Confirmando ubicación cercana a un lugar guardado',
      notificationColor: '#2563EB',
    },
  });
}

async function stopLocationTaskIfIdle(): Promise<void> {
  const entries = await readEntries();
  if (entries.length > 0) return;
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) await Location.stopLocationUpdatesAsync(POLLING_TASK);
}

/**
 * Arranca el polling de confirmación para una alarma. Se llama desde el handler
 * del geofence cuando dispara ENTER en el radio externo.
 */
export async function startConfirmation(
  entry: Omit<PollingEntry, 'startedAt'>,
): Promise<void> {
  const full: PollingEntry = { ...entry, startedAt: Date.now() };
  await AsyncStorage.setItem(
    `${POLLING_PREFIX}${entry.alarmId}`,
    JSON.stringify(full),
  );
  await ensureLocationTaskRunning();
}

/**
 * Cancela el polling para una alarma (p. ej. usuario salió del radio externo
 * antes de confirmarse el enter). Idempotente.
 */
export async function cancelConfirmation(alarmId: string): Promise<void> {
  await removeEntry(alarmId);
  await stopLocationTaskIfIdle();
}

/**
 * Limpia todos los pollings y para el task. Llamar al hacer logout o al
 * desregistrar todas las alarmas.
 */
export async function clearAllPolling(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const pollingKeys = keys.filter((k) => k.startsWith(POLLING_PREFIX));
  if (pollingKeys.length > 0) await AsyncStorage.multiRemove(pollingKeys);
  const running = await Location.hasStartedLocationUpdatesAsync(POLLING_TASK);
  if (running) await Location.stopLocationUpdatesAsync(POLLING_TASK);
}

type LocationTaskData = { locations: Location.LocationObject[] };

TaskManager.defineTask<LocationTaskData>(POLLING_TASK, async ({ data, error }) => {
  if (error) return;
  if (!data?.locations || data.locations.length === 0) return;
  // Usamos solo la última lectura. Las anteriores pueden estar muy desfasadas.
  const last = data.locations[data.locations.length - 1];
  const cur: LatLng = {
    latitude: last.coords.latitude,
    longitude: last.coords.longitude,
  };

  const entries = await readEntries();
  if (entries.length === 0) {
    await stopLocationTaskIfIdle();
    return;
  }

  const now = Date.now();
  for (const entry of entries) {
    const expired = now - entry.startedAt > CONFIRM_TIMEOUT_MS;
    if (expired) {
      await removeEntry(entry.alarmId);
      continue;
    }
    const dist = distanceMeters(cur, {
      latitude: entry.centerLat,
      longitude: entry.centerLng,
    });
    if (dist <= entry.innerRadius) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: entry.title,
          body: entry.notes ?? '',
          data: { alarmId: entry.alarmId, eventType: 'enter', confirmed: true },
          categoryIdentifier: ALARM_CATEGORY,
          sound: 'default',
        },
        trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
      });
      await removeEntry(entry.alarmId);
    }
  }

  await stopLocationTaskIfIdle();
});
