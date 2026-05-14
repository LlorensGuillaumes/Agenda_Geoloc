/**
 * Lógica de "fire-and-deactivate" para alarmas location con `repeat: 'once'`.
 *
 * Cuando una alarma `once` dispara su notificación:
 *  1. Se marca `fired:{alarmId}` local con timestamp.
 *  2. Se intenta hacer PATCH al API para desactivar `isActive=false`.
 *
 * Si el API call falla (offline, Tailscale caído), el flag local sigue
 * protegiendo de disparos repetidos hasta que el sync de la app vuelva online
 * y actualice el estado real. Si la app vuelve online y sync detecta que la
 * alarma sigue `isActive=true`, retira el geofence localmente (porque tiene
 * el flag `fired`) y reintenta el patch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const FIRED_PREFIX = 'fired:';
const FIRED_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TOKEN_KEY = 'agenda.auth.token'; // alineado con lib/auth/storage.ts
const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:4000';
const ORIGIN = 'http://localhost:8081';

async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function patchAlarmInactive(alarmId: string): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/alarms/${alarmId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify({ isActive: false }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Marca una alarma como disparada. Solo aplica si la alarma es `once` (que es
 * el default cuando `repeat` no está definido).
 */
export async function markAlarmFired(
  alarmId: string,
  repeat: 'once' | 'always' | undefined,
): Promise<void> {
  if (repeat === 'always') return;
  await AsyncStorage.setItem(`${FIRED_PREFIX}${alarmId}`, String(Date.now()));
  // Best-effort: si falla, el flag local impide repetir hasta que vuelva online.
  patchAlarmInactive(alarmId).catch(() => {});
}

/**
 * Variante usada desde polling.ts: lee el `repeat` de la cache del geofence
 * para no tener que pasarlo explícitamente.
 */
export async function markAlarmFiredIfOnce(alarmId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(`geofence:${alarmId}`);
    if (!raw) {
      // Sin info de la cache, asumimos `once` (más conservador).
      await markAlarmFired(alarmId, undefined);
      return;
    }
    const info = JSON.parse(raw) as { repeat?: 'once' | 'always' };
    await markAlarmFired(alarmId, info.repeat);
  } catch {
    await markAlarmFired(alarmId, undefined);
  }
}

/**
 * ¿Está esta alarma marcada como ya disparada y dentro del TTL?
 */
export async function isAlarmFired(alarmId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(`${FIRED_PREFIX}${alarmId}`);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < FIRED_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Limpia los flags de "fired" para los alarmIds dados. Llamar desde sync con
 * los IDs de alarmas que SIGUEN activas (porque el server ya las marcó
 * isActive=false vía nuestro patch, o porque son `always`).
 *
 * Nota: si tras sync una alarma `once` sigue `isActive=true` pero local tiene
 * fired flag, significa que el patch falló (offline). En ese caso NO se
 * limpia el flag — sigue protegiendo contra disparos repetidos — y se
 * reintenta el patch.
 */
export async function reconcileFiredFlags(
  stillActiveAlarmIds: Set<string>,
): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const firedKeys = keys.filter((k) => k.startsWith(FIRED_PREFIX));
  if (firedKeys.length === 0) return;
  const toRemove: string[] = [];
  for (const k of firedKeys) {
    const alarmId = k.slice(FIRED_PREFIX.length);
    if (!stillActiveAlarmIds.has(alarmId)) {
      // Alarma ya no está activa (borrada o el patch funcionó) → flag innecesario
      toRemove.push(k);
    } else {
      // Alarma sigue activa en el server pero local dice fired → reintenta patch
      patchAlarmInactive(alarmId).catch(() => {});
    }
  }
  if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
}

export async function clearAllFiredFlags(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const firedKeys = keys.filter((k) => k.startsWith(FIRED_PREFIX));
  if (firedKeys.length > 0) await AsyncStorage.multiRemove(firedKeys);
}
