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
const TRACKING_MIN_MOVE_M = 40; // re-registra quan ens hem mogut > 40m
const TRACKING_CENTER_KEY = 'tracking:center';

type TrackingTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

// Definició del handler. L'única feina és cridar el rescat — quan el
// location task arrenqui, ja registrarà la tracking geofence a la nova
// posició via updateTrackingGeofence().
TaskManager.defineTask<TrackingTaskData>(TRACKING_TASK, async ({ error }) => {
  if (error) return;
  try {
    await ensureLocationTaskRunning();
  } catch {
    // ignore
  }
});

function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Crida idempotent: si l'usuari s'ha mogut prou de l'anterior centre,
 * re-registra la geofence al nou centre. Si no, no fa res.
 *
 * Cridar des del location polling task amb cada mostra de GPS.
 */
export async function updateTrackingGeofence(
  lat: number,
  lng: number,
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  try {
    const raw = await AsyncStorage.getItem(TRACKING_CENTER_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as { lat: number; lng: number };
      const dist = haversine(lat, lng, prev.lat, prev.lng);
      if (dist < TRACKING_MIN_MOVE_M) return;
    }
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
    // Si fa fallida (p.ex. permisos), no insistim — la pròxima mostra
    // ho tornarà a provar.
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
