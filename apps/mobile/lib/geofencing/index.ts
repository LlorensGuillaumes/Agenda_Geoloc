import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Alarm, Place } from '../api/client';

export const GEOFENCE_TASK = 'agenda.geofence-task';
const CACHE_PREFIX = 'geofence:';
const IOS_GEOFENCE_LIMIT = 20;

type CachedAlarmInfo = {
  title: string;
  notes: string | null;
  event: 'enter' | 'exit' | 'nearby';
};

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

  const isEnter = eventType === Location.GeofencingEventType.Enter;

  let info: CachedAlarmInfo | null = null;
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${region.identifier}`);
    info = raw ? (JSON.parse(raw) as CachedAlarmInfo) : null;
  } catch {
    // Cache lost or corrupted; we still notify with a generic body.
  }

  // El SO solo dispara los eventos que pedimos, pero defendemos por si acaso.
  const wantedEnter = !info || info.event === 'enter' || info.event === 'nearby';
  const wantedExit = !info || info.event === 'exit';
  if (isEnter && !wantedEnter) return;
  if (!isEnter && !wantedExit) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: info?.title ?? 'Alarma',
      body: info?.notes ?? '',
      data: {
        alarmId: region.identifier,
        eventType: isEnter ? 'enter' : 'exit',
      },
    },
    trigger: null,
  });
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

    const wantsEnter = cfg.event === 'enter' || cfg.event === 'nearby';
    const wantsExit = cfg.event === 'exit';

    candidates.push({
      region: {
        identifier: alarm.id,
        latitude,
        longitude,
        radius,
        notifyOnEnter: wantsEnter,
        notifyOnExit: wantsExit,
      },
      cache: {
        title: alarm.title,
        notes: alarm.notes,
        event: cfg.event,
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
  }

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
