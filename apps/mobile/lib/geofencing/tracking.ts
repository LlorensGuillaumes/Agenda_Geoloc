/**
 * Rolling tracking geofence: una geofence "fantasma" centrada a la posició
 * actual de l'usuari amb radi 80m. Quan l'usuari camina i en surt, GMS
 * dispara EXIT i desperta l'app encara que MIUI hagi matat el procés.
 * És el patró usat per Google Maps i Strava per fer tracking sense haver
 * de mantenir el servei viu 24/7.
 *
 * Aquesta task és independent de GEOFENCE_TASK (que gestiona les alarmes
 * de l'usuari). L'única feina del seu handler és ressuscitar el location
 * task — el reposicionament de la geofence el fa el location task amb cada
 * mostra de GPS via `updateTrackingGeofence`.
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureLocationTaskRunning } from './polling';

export const TRACKING_TASK = 'agenda.tracking-geofence-task';
const TRACKING_ID = '__tracking__';
const TRACKING_RADIUS_M = 80;
const TRACKING_CENTER_KEY = 'tracking:center';

type TrackingTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

// Handler de la tracking geofence. Quan GMS dispara EXIT (l'usuari s'ha
// allunyat 80m del centre actual), netegem el centre i revivim el location
// task. La pròxima mostra de GPS registrarà una nova geofence al nou centre.
TaskManager.defineTask<TrackingTaskData>(TRACKING_TASK, async ({ error }) => {
  if (error) return;
  try {
    await AsyncStorage.removeItem(TRACKING_CENTER_KEY);
  } catch {
    // ignore
  }
  try {
    await ensureLocationTaskRunning();
  } catch {
    // ignore
  }
});

/**
 * Idempotent: si NO hi ha cap tracking center registrat, en registra un al
 * punt donat amb radi 80m. Si ja n'hi ha un, no fa res.
 *
 * El propòsit és que la geofence quedi estable un cop creada. Cada
 * re-registre fa que GMS hagi de tornar a calibrar (30-90s); si actualitzem
 * cada sample, GMS no té temps d'arribar a disparar EXIT abans que la
 * geofence canviï. Ara la geofence queda en repòs fins que GMS la dispara,
 * el handler neteja el centre, i el següent sample n'estableix una de nova.
 */
export async function ensureTrackingGeofence(
  lat: number,
  lng: number,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    const raw = await AsyncStorage.getItem(TRACKING_CENTER_KEY);
    if (raw) return; // ja hi ha una geofence — no toquem fins que dispari
  } catch {
    // ignore
  }

  try {
    await Location.startGeofencingAsync(TRACKING_TASK, [
      {
        identifier: TRACKING_ID,
        latitude: lat,
        longitude: lng,
        radius: TRACKING_RADIUS_M,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
    await AsyncStorage.setItem(
      TRACKING_CENTER_KEY,
      JSON.stringify({ lat, lng }),
    );
  } catch {
    // ignore — el següent sample tornarà a provar
  }
}

export async function stopTrackingGeofence(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const running = await Location.hasStartedGeofencingAsync(TRACKING_TASK);
    if (running) await Location.stopGeofencingAsync(TRACKING_TASK);
  } catch {
    // ignore
  }
  try {
    await AsyncStorage.removeItem(TRACKING_CENTER_KEY);
  } catch {
    // ignore
  }
}

export async function isTrackingGeofenceActive(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Location.hasStartedGeofencingAsync(TRACKING_TASK);
  } catch {
    return false;
  }
}
