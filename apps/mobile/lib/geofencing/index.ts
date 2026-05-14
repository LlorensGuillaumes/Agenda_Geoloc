import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Alarm, Place } from '../api/client';
import {
  cancelConfirmation,
  clearAllPolling,
  setKeepaliveAlarms,
  startConfirmation,
} from './polling';
import {
  clearAllFiredFlags,
  isAlarmFired,
  markAlarmFired,
  reconcileFiredFlags,
} from './fired';
import { ALARM_CATEGORY, ALARM_CHANNEL_ID } from '../notifications';

export const GEOFENCE_TASK = 'agenda.geofence-task';
const CACHE_PREFIX = 'geofence:';
const IOS_GEOFENCE_LIMIT = 20;

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

  // Para ENTER preciso: arrancamos polling de confirmación. La notificación
  // saldrá cuando el polling confirme que el usuario entró al radio interno.
  // Para EXIT: notificamos al instante con el margen del radio externo
  // (precisión ~radio configurado, suficiente para detectar "ya he salido").
  if (isEnter && info) {
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
    });
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: info?.title ?? 'Alarma',
      body: info?.notes ?? '',
      data: {
        alarmId: region.identifier,
        eventType: isEnter ? 'enter' : 'exit',
      },
      categoryIdentifier: ALARM_CATEGORY,
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: ALARM_CHANNEL_ID } : null,
  });
  // Para EXIT directo: marcar como fired si es de un solo uso.
  if (!isEnter) {
    await markAlarmFired(region.identifier, info?.repeat);
  }
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
