import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIF_PREFIX = 'alarm-notif:';

// Cómo se muestra una notificación cuando llega con la app en foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function scheduleAlarmNotification(args: {
  alarmId: string;
  title: string;
  body?: string;
  datetime: string;
}): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;
  const date = new Date(args.datetime);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return null;
  }

  // Cancela cualquier notificación previa para esta alarma (caso de edición).
  await cancelAlarmNotificationByAlarmId(args.alarmId);

  const notifId = await Notifications.scheduleNotificationAsync({
    content: {
      title: args.title,
      body: args.body ?? '',
      data: { alarmId: args.alarmId },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
    },
  });
  await AsyncStorage.setItem(`${NOTIF_PREFIX}${args.alarmId}`, notifId);
  return notifId;
}

export async function cancelAlarmNotificationByAlarmId(
  alarmId: string,
): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(`${NOTIF_PREFIX}${alarmId}`);
    if (stored) {
      await Notifications.cancelScheduledNotificationAsync(stored).catch(() => {});
    }
    await AsyncStorage.removeItem(`${NOTIF_PREFIX}${alarmId}`);
  } catch {
    // ignore
  }
}
