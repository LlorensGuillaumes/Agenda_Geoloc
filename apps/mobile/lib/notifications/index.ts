import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotifyConfig, TimeConfig } from '../api/client';

const NOTIF_PREFIX = 'alarm-notif:';
export const ALARM_CATEGORY = 'alarm';
export const ALARM_ACTIONS_CATEGORY = 'alarm_actions';
export const ALARM_CHANNEL_ID = 'alarms';

function sanitizePhone(phone: string): string {
  // Quita espacios, guiones, paréntesis. Mantiene `+` líder.
  return phone.replace(/[^\d+]/g, '');
}

function pickCategory(notifyConfig?: NotifyConfig | null): string {
  const hasActions = (notifyConfig?.actions?.length ?? 0) > 0;
  return hasActions ? ALARM_ACTIONS_CATEGORY : ALARM_CATEGORY;
}

export function buildContactData(notifyConfig?: NotifyConfig | null) {
  if (!notifyConfig) return undefined;
  return {
    contactName: notifyConfig.contactName,
    contactPhone: notifyConfig.contactPhone,
    whatsappMessage: notifyConfig.whatsappMessage,
    actions: notifyConfig.actions,
  };
}

// Cómo se muestra una notificación cuando llega con la app en foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Canal Android con prioridad MAX, sonido y vibración estilo alarma.
// - bypassDnd: true → suena aunque el móvil esté en "No molestar"
// - patrón de vibración largo (~5s) para que sea evidente
// - importance MAX + lockscreenVisibility PUBLIC → heads-up notif que cubre
//   la pantalla bloqueada
//
// Para un ringtone personalizado de alarma:
//  1. Coloca el MP3/OGG en `apps/mobile/assets/sounds/alarm.mp3`
//  2. Añade `"sounds": ["./assets/sounds/alarm.mp3"]` al plugin
//     `expo-notifications` de app.json
//  3. Cambia `sound: 'default'` por `sound: 'alarm.mp3'` aquí
//  4. Rebuild EAS (es asset nativo, no OTA)
//
// Nota: si el usuario ya tenía el canal creado con la versión anterior y
// ha tocado manualmente la configuración del canal en Ajustes de Android,
// estos cambios pueden no aplicarse — Android prioriza la elección del
// usuario. En ese caso, hay que reinstalar o resetear el canal a mano.
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Alarmas',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 300, 600, 300, 600, 300, 600],
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  }).catch(() => {
    // ignore: en Expo Go o si los permisos no están dados aún
  });
}

// Categoría por defecto: 3 botones de snooze.
Notifications.setNotificationCategoryAsync(ALARM_CATEGORY, [
  { identifier: 'snooze_5', buttonTitle: '+5 min', options: { opensAppToForeground: false } },
  { identifier: 'snooze_10', buttonTitle: '+10 min', options: { opensAppToForeground: false } },
  { identifier: 'snooze_15', buttonTitle: '+15 min', options: { opensAppToForeground: false } },
]).catch(() => {
  // ignore: en Expo Go puede fallar
});

// Categoría con acciones de contacto. Android limita a 3 botones por
// notificación así que aquí sacrificamos snooze a favor de las acciones
// directas (llamada y WhatsApp). Para alarmas "llámame al llegar" tiene
// más sentido el atajo que el posponer.
Notifications.setNotificationCategoryAsync(ALARM_ACTIONS_CATEGORY, [
  { identifier: 'call', buttonTitle: 'Trucar', options: { opensAppToForeground: true } },
  { identifier: 'whatsapp', buttonTitle: 'WhatsApp', options: { opensAppToForeground: true } },
]).catch(() => {
  // ignore
});

// Listener global de respuestas. Funciona aunque la app esté en background.
Notifications.addNotificationResponseReceivedListener(async (response) => {
  const actionId = response.actionIdentifier;
  const { content } = response.notification.request;
  const data = (content.data ?? {}) as Record<string, unknown>;

  if (actionId === 'call') {
    const phone = typeof data.contactPhone === 'string' ? data.contactPhone : '';
    if (phone) Linking.openURL(`tel:${sanitizePhone(phone)}`).catch(() => {});
    return;
  }

  if (actionId === 'whatsapp') {
    const phone = typeof data.contactPhone === 'string' ? data.contactPhone : '';
    if (!phone) return;
    const cleaned = sanitizePhone(phone).replace(/^\+/, '');
    const msg = typeof data.whatsappMessage === 'string' ? data.whatsappMessage : '';
    const url = msg
      ? `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/${cleaned}`;
    Linking.openURL(url).catch(() => {});
    return;
  }

  if (actionId.startsWith('snooze_')) {
    const minutes = actionId === 'snooze_5' ? 5 : actionId === 'snooze_10' ? 10 : 15;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: content.title ?? 'Alarma',
        body: content.body ?? '',
        data: { ...data, snoozedFromAlarmId: data.alarmId },
        categoryIdentifier: content.categoryIdentifier ?? ALARM_CATEGORY,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: minutes * 60,
        channelId: Platform.OS === 'android' ? ALARM_CHANNEL_ID : undefined,
      } as Notifications.NotificationTriggerInput,
    });
  }
});

export async function ensureNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// Convierte el día tipo Date.getDay() (0=Sunday, 1=Monday, ..., 6=Saturday)
// al formato de expo-notifications, que usa 1=Sunday, 2=Monday, ..., 7=Saturday.
function jsDayToExpoWeekday(jsDay: number): number {
  return jsDay + 1;
}

/**
 * Programa una o varias notificaciones locales para una alarma según su
 * timeConfig. Devuelve los notifIds creados (puede ser >1 con weekly).
 * Cancela cualquier notificación previa de la misma alarma antes de programar.
 *
 * Devuelve [] si no hay permisos, si la fecha está en el pasado para 'once',
 * o si weekly no tiene días seleccionados.
 */
export async function scheduleAlarmNotification(args: {
  alarmId: string;
  title: string;
  body?: string;
  timeConfig: TimeConfig;
  notifyConfig?: NotifyConfig | null;
}): Promise<string[]> {
  const granted = await ensureNotificationPermission();
  if (!granted) return [];

  // Cancelar cualquier programación previa de esta alarma.
  await cancelAlarmNotificationByAlarmId(args.alarmId);

  const ids: string[] = [];
  const { timeConfig, notifyConfig } = args;
  const contactData = buildContactData(notifyConfig);
  const content = {
    title: args.title,
    body: args.body ?? '',
    data: { alarmId: args.alarmId, ...(contactData ?? {}) },
    categoryIdentifier: pickCategory(notifyConfig),
    sound: 'default' as const,
  };

  if (timeConfig.repeat === 'once') {
    if (!timeConfig.datetime) return [];
    const date = new Date(timeConfig.datetime);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      return [];
    }
    const id = await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: Platform.OS === 'android' ? ALARM_CHANNEL_ID : undefined,
      },
    });
    ids.push(id);
  } else if (timeConfig.repeat === 'daily') {
    // Reusa la hora del datetime para hour/minute.
    const date = timeConfig.datetime ? new Date(timeConfig.datetime) : new Date();
    const id = await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: date.getHours(),
        minute: date.getMinutes(),
        channelId: Platform.OS === 'android' ? ALARM_CHANNEL_ID : undefined,
      },
    });
    ids.push(id);
  } else if (timeConfig.repeat === 'weekly') {
    const weekdays = timeConfig.weekdays ?? [];
    if (weekdays.length === 0) return [];
    const date = timeConfig.datetime ? new Date(timeConfig.datetime) : new Date();
    for (const jsDay of weekdays) {
      const id = await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: jsDayToExpoWeekday(jsDay),
          hour: date.getHours(),
          minute: date.getMinutes(),
          channelId: Platform.OS === 'android' ? ALARM_CHANNEL_ID : undefined,
        },
      });
      ids.push(id);
    }
  }

  if (ids.length > 0) {
    await AsyncStorage.setItem(`${NOTIF_PREFIX}${args.alarmId}`, JSON.stringify(ids));
  }
  return ids;
}

export async function cancelAlarmNotificationByAlarmId(alarmId: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(`${NOTIF_PREFIX}${alarmId}`);
    if (stored) {
      // Soporta tanto el formato antiguo (single id string) como el nuevo (JSON array).
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(stored);
        ids = Array.isArray(parsed) ? parsed : [stored];
      } catch {
        ids = [stored];
      }
      for (const id of ids) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
    }
    await AsyncStorage.removeItem(`${NOTIF_PREFIX}${alarmId}`);
  } catch {
    // ignore
  }
}
