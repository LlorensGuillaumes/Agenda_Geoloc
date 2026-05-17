/**
 * Mode "Test" — enregistra cada location update + l'estat de cada alarma
 * al backend per poder analitzar després per què (no) ha disparat.
 *
 * Flag local a AsyncStorage. Encén/apaga des d'Ajustos. Mentre està actiu,
 * el polling task de geofencing crida `sendTraceBatch` amb un snapshot per
 * cada alarma activa a cada update que rep.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { TraceItemInput } from '@agenda/shared';

const FLAG_KEY = 'testMode:enabled';
const TOKEN_KEY = 'agenda.auth.token';
const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ?? 'http://localhost:4000';
const ORIGIN = 'http://localhost:8081';

export async function getTestModeEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FLAG_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setTestModeEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(FLAG_KEY, enabled ? '1' : '0');
}

async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function sendTraceBatch(items: TraceItemInput[]): Promise<void> {
  if (items.length === 0) return;
  const token = await getToken();
  if (!token) return;
  try {
    await fetch(`${API_URL}/api/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify({ traces: items }),
    });
  } catch {
    // Best-effort: si la xarxa va malament, perdem la trace. No volem
    // bloquejar el polling per això.
  }
}

export async function clearTraces(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/traces`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}
