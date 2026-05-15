import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  ApiError,
  type Alarm,
  type LocationConfig,
  type TimeConfig,
} from '@/lib/api/client';
import {
  useAcceptAlarm,
  useAlarms,
  useDeleteAlarm,
  useRejectAlarm,
  useUpdateAlarm,
} from '@/lib/alarms/hooks';
import { usePlaces, useSharedWithMePlaces } from '@/lib/places/hooks';
import { useFriends } from '@/lib/friends/hooks';
import { useAuthStore } from '@/lib/auth/store';
import {
  cancelAlarmNotificationByAlarmId,
  scheduleAlarmNotification,
} from '@/lib/notifications';
import { useToast } from '@/lib/ui/toast';

function triggerLabelKey(t: Alarm['triggerType']): string {
  if (t === 'time') return 'alarms.trigger.time';
  if (t === 'location') return 'alarms.trigger.location';
  return 'alarms.trigger.both';
}

function eventLabelKey(e: LocationConfig['event']): string {
  if (e === 'enter') return 'alarms.eventEnter';
  if (e === 'exit') return 'alarms.eventExit';
  return 'alarms.eventNearby';
}

function formatDateTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function describeTimeConfig(
  cfg: NonNullable<Alarm['timeConfig']>,
  lang: string,
  weekdayLabels: string[],
  every: string,
): string {
  if (cfg.repeat === 'daily' && cfg.datetime) {
    return `${every} · ${formatTime(cfg.datetime, lang)}`;
  }
  if (cfg.repeat === 'weekly' && cfg.datetime) {
    const days = (cfg.weekdays ?? [])
      .map((d) => {
        // value 0=Sunday..6=Saturday → index in [Mon..Sun]
        const idx = d === 0 ? 6 : d - 1;
        return weekdayLabels[idx];
      })
      .join(' ');
    return `${days || '—'} · ${formatTime(cfg.datetime, lang)}`;
  }
  return cfg.datetime ? formatDateTime(cfg.datetime, lang) : '';
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-start py-2">
      <Text className="text-sm text-gray-500 mr-3">{label}</Text>
      <Text className="text-sm text-gray-900 flex-1 text-right">{value}</Text>
    </View>
  );
}

export default function AlarmDetailScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const alarmsQuery = useAlarms();
  const placesQuery = usePlaces();
  const sharedPlacesQuery = useSharedWithMePlaces();
  const friendsQuery = useFriends();
  const userId = useAuthStore((s) => s.user?.id);
  const updateAlarm = useUpdateAlarm();
  const deleteAlarm = useDeleteAlarm();
  const acceptAlarm = useAcceptAlarm();
  const rejectAlarm = useRejectAlarm();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const alarm = alarmsQuery.data?.find((a) => a.id === id);

  if (alarmsQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!alarm) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-6">
        <Stack.Screen options={{ title: t('alarms.detailTitle'), headerShown: true }} />
        <Ionicons name="alert-circle-outline" size={48} color="#9CA3AF" />
        <Text className="text-lg font-semibold text-gray-900 mt-3">
          {t('alarms.notFound')}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 px-4 py-2 border border-gray-300 rounded-lg active:bg-gray-100"
        >
          <Text className="text-gray-700">{t('common.back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const handleToggleActive = async () => {
    if (busy) return;
    setBusy(true);
    const newActive = !alarm.isActive;
    try {
      await updateAlarm.mutateAsync({
        id: alarm.id,
        data: { isActive: newActive },
      });
      // Pausar: cancelar notif programada
      // Reanudar: re-schedule si tiene timeConfig
      if (!newActive) {
        await cancelAlarmNotificationByAlarmId(alarm.id);
      } else if (alarm.timeConfig) {
        await scheduleAlarmNotification({
          alarmId: alarm.id,
          title: alarm.title,
          body: alarm.notes ?? undefined,
          timeConfig: alarm.timeConfig,
        });
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Unknown';
      Alert.alert(t('common.error'), `${t('alarms.updateError')}\n${message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      t('alarms.deleteConfirmTitle'),
      t('alarms.deleteConfirmBody', { title: alarm.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await cancelAlarmNotificationByAlarmId(alarm.id);
              await deleteAlarm.mutateAsync(alarm.id);
              router.back();
            } catch (err) {
              const message =
                err instanceof ApiError
                  ? `HTTP ${err.status}`
                  : err instanceof Error
                    ? err.message
                    : 'Unknown';
              Alert.alert(t('common.error'), `${t('alarms.deleteError')}\n${message}`);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const placeName = (() => {
    const cfg = alarm.locationConfig;
    if (!cfg) return null;
    if (cfg.mode === 'saved_place' && cfg.placeId) {
      // Busca primero en lugares propios, luego en compartidos conmigo
      // (porque la alarma puede referenciar un place del owner — cuando el
      // owner soy yo o cuando un amigo me ha compartido el lugar).
      const place =
        placesQuery.data?.find((p) => p.id === cfg.placeId) ??
        sharedPlacesQuery.data?.find((p) => p.id === cfg.placeId);
      return place?.name ?? t('alarms.unknownPlace');
    }
    if (cfg.mode === 'custom_point' && cfg.customPoint) {
      return `${cfg.customPoint.latitude.toFixed(4)}, ${cfg.customPoint.longitude.toFixed(4)}`;
    }
    return null;
  })();

  const isPendingForMe =
    alarm.ownerId === userId && alarm.status === 'pending_acceptance';
  const isSentByMe = alarm.creatorId === userId && alarm.ownerId !== userId;

  const friendByUserId = (uid: string): string | undefined =>
    friendsQuery.data?.find((f) => f.friend?.id === uid)?.friend?.name;

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const accepted = await acceptAlarm.mutateAsync(alarm.id);
      if (
        (accepted.triggerType === 'time' ||
          accepted.triggerType === 'time_and_location') &&
        accepted.timeConfig
      ) {
        await scheduleAlarmNotification({
          alarmId: accepted.id,
          title: accepted.title,
          body: accepted.notes ?? undefined,
          timeConfig: accepted.timeConfig,
        });
      }
      showToast(t('alarms.acceptedToast'), 'success');
      router.back();
    } catch {
      showToast(t('alarms.acceptError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = () => {
    Alert.alert(
      t('alarms.rejectConfirmTitle'),
      t('alarms.rejectConfirmBody', { title: alarm.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alarms.rejectCta'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await rejectAlarm.mutateAsync(alarm.id);
              showToast(t('alarms.rejectedToast'), 'success');
              router.back();
            } catch {
              showToast(t('alarms.rejectError'), 'error');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <Stack.Screen options={{ title: t('alarms.detailTitle'), headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <Text className="text-xl font-bold text-gray-900 mb-1">{alarm.title}</Text>
          {alarm.notes && (
            <Text className="text-sm text-gray-600 mb-3">{alarm.notes}</Text>
          )}

          <View className="border-t border-gray-100 pt-2">
            <InfoRow
              label={t('alarms.triggerSection')}
              value={t(triggerLabelKey(alarm.triggerType))}
            />
            {alarm.timeConfig?.datetime && (
              <InfoRow
                label={t('alarms.timeSection')}
                value={describeTimeConfig(
                  alarm.timeConfig,
                  i18n.language,
                  t('alarms.weekdayInitials', { returnObjects: true }) as string[],
                  t('alarms.repeatEveryDay'),
                )}
              />
            )}
            {alarm.locationConfig && (
              <>
                {placeName && (
                  <InfoRow label={t('alarms.locationSection')} value={placeName} />
                )}
                <InfoRow
                  label={t('alarms.eventLabel')}
                  value={t(eventLabelKey(alarm.locationConfig.event))}
                />
                {alarm.locationConfig.mode === 'custom_point' &&
                  alarm.locationConfig.customPoint && (
                    <InfoRow
                      label={t('places.radius')}
                      value={`${alarm.locationConfig.customPoint.radiusMeters}m`}
                    />
                  )}
              </>
            )}
            {alarm.notifyConfig && alarm.notifyConfig.actions.length > 0 && (
              <InfoRow
                label={t('alarms.notifyContactSection')}
                value={[
                  alarm.notifyConfig.contactName || alarm.notifyConfig.contactPhone || '',
                  alarm.notifyConfig.actions
                    .map((a) =>
                      a === 'call' ? t('alarms.actionCall') : t('alarms.actionWhatsApp'),
                    )
                    .join(' · '),
                ]
                  .filter(Boolean)
                  .join(' — ')}
              />
            )}
          </View>
        </View>

        {isPendingForMe ? (
          <View className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
            <Text className="text-sm text-amber-800 mb-3">
              {t('alarms.fromFriend', {
                name: friendByUserId(alarm.creatorId) ?? t('alarms.unknownFriend'),
              })}
            </Text>
            <View className="flex-row">
              <Pressable
                onPress={handleAccept}
                disabled={busy}
                className={`flex-1 rounded-lg py-3 mr-2 items-center ${
                  busy ? 'bg-green-400' : 'bg-green-600 active:bg-green-700'
                }`}
              >
                <Text className="text-white font-semibold">
                  {t('alarms.acceptCta')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleReject}
                disabled={busy}
                className="flex-1 bg-white border border-gray-300 rounded-lg py-3 items-center active:bg-gray-100"
              >
                <Text className="text-gray-700 font-semibold">
                  {t('alarms.rejectCta')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : isSentByMe ? (
          <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            <Text className="text-sm text-gray-700 mb-1">
              {t('alarms.sentTo', {
                name: friendByUserId(alarm.ownerId) ?? t('alarms.unknownFriend'),
              })}
            </Text>
            <Text className="text-xs text-gray-500 mb-3">
              {alarm.status === 'pending_acceptance'
                ? t('alarms.statusPending')
                : t('alarms.statusActive')}
            </Text>
            <Pressable
              onPress={handleDelete}
              disabled={busy}
              className="border border-red-300 rounded-lg py-3 items-center active:bg-red-50"
            >
              <Text className="text-red-600 font-semibold">
                {t('alarms.withdrawCta')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <Text className="text-base font-medium text-gray-900">
                  {t('alarms.activeToggle')}
                </Text>
                <Text className="text-xs text-gray-500 mt-1">
                  {alarm.isActive ? t('alarms.activeOn') : t('alarms.activeOff')}
                </Text>
              </View>
              <Switch
                value={alarm.isActive}
                onValueChange={handleToggleActive}
                disabled={busy}
                trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
              />
            </View>

            <Pressable
              onPress={handleDelete}
              disabled={busy}
              className="border border-red-300 bg-white rounded-lg py-3 items-center active:bg-red-50"
            >
              <Text className="text-red-600 font-semibold">{t('common.delete')}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
