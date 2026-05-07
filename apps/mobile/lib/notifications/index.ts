import * as Notifications from 'expo-notifications';

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
  return Notifications.scheduleNotificationAsync({
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
}

export async function cancelAlarmNotification(notifId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notifId);
  } catch {
    // Si ya disparó o no existe, ignoramos.
  }
}
