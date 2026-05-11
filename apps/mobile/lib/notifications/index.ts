import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TimeConfig } from '../api/client';

const NOTIF_PREFIX = 'alarm-notif:';
export const ALARM_CATEGORY = 'alarm';
export const ALARM_CHANNEL_ID = 'alarms';

// Cómo se muestra una notificación cuando llega con la app en foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Canal Android con prioridad MAX, sonido y vibración. En iOS no aplica.
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Alarmas',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  }).catch(() => {
    // ignore: en Expo Go o si los permisos no están dados aún
  });
}

// Categoría con botones de posponer 5/10/15 min.
Notifications.setNotificationCategoryAsync(ALARM_CATEGORY, [
  { identifier: 'snooze_5', buttonTitle: '+5 min', options: { opensAppToForeground: false } },
  { identifier: 'snooze_10', buttonTitle: '+10 min', options: { opensAppToForeground: false } },
  { identifier: 'snooze_15', buttonTitle: '+15 min', options: { opensAppToForeground: false } },
]).catch(() => {
  // ignore: en Expo Go puede fallar
});

// Listener global de respuestas. Funciona aunque la app esté en background.
Notifications.addNotificationResponseReceivedListener(async (response) => {
  const actionId = response.actionIdentifier;
  if (!actionId.startsWith('snooze_')) return;
  const minutes = actionId === 'snooze_5' ? 5 : actionId === 'snooze_10' ? 10 : 15;
  const { content } = response.notification.request;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title ?? 'Alarma',
      body: content.body ?? '',
      data: { ...(content.data ?? {}), snoozedFromAlarmId: content.data?.alarmId },
      categoryIdentifier: ALARM_CATEGORY,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: minutes * 60,
      channelId: Platform.OS === 'android' ? ALARM_CHANNEL_ID : undefined,
    } as Notifications.NotificationTriggerInput,
  });
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
}): Promise<string[]> {
  const granted = await ensureNotificationPermission();
  if (!granted) return [];

  // Cancelar cualquier programación previa de esta alarma.
  await cancelAlarmNotificationByAlarmId(args.alarmId);

  const ids: string[] = [];
  const { timeConfig } = args;
  const content = {
    title: args.title,
    body: args.body ?? '',
    data: { alarmId: args.alarmId },
    categoryIdentifier: ALARM_CATEGORY,
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
