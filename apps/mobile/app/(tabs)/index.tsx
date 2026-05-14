import { useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  useAcceptAlarm,
  useAlarms,
  useDeleteAlarm,
  useRejectAlarm,
} from '@/lib/alarms/hooks';
import { usePlaces } from '@/lib/places/hooks';
import { useFriends } from '@/lib/friends/hooks';
import { useAuthStore } from '@/lib/auth/store';
import { formatAlarmSummary, type FormatAlarmDeps } from '@/lib/alarms/format';
import {
  cancelAlarmNotificationByAlarmId,
  scheduleAlarmNotification,
} from '@/lib/notifications';
import type { Alarm } from '@/lib/api/client';

function iconFor(alarm: Alarm): keyof typeof Ionicons.glyphMap {
  if (alarm.triggerType === 'time') return 'alarm';
  if (alarm.triggerType === 'location') return 'location';
  return 'layers';
}

function PendingAlarmCard({
  alarm,
  summary,
  creatorName,
  onAccept,
  onReject,
  busy,
}: {
  alarm: Alarm;
  summary: string;
  creatorName: string;
  onAccept: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-2">
      <View className="flex-row items-start mb-3">
        <View className="w-10 h-10 rounded-full bg-amber-100 items-center justify-center mr-3">
          <Ionicons name={iconFor(alarm)} size={20} color="#D97706" />
        </View>
        <View className="flex-1">
          <Text
            className="text-base font-semibold text-gray-900"
            numberOfLines={1}
          >
            {alarm.title}
          </Text>
          {summary ? (
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
          <Text className="text-xs text-amber-700 mt-0.5">
            {t('alarms.fromFriend', { name: creatorName })}
          </Text>
        </View>
      </View>
      <View className="flex-row">
        <Pressable
          onPress={onAccept}
          disabled={busy}
          className={`flex-1 rounded-lg py-2 mr-2 items-center ${
            busy ? 'bg-green-400' : 'bg-green-600 active:bg-green-700'
          }`}
        >
          <Text className="text-white font-semibold text-sm">
            {t('alarms.acceptCta')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onReject}
          disabled={busy}
          className="flex-1 bg-white border border-gray-300 rounded-lg py-2 items-center active:bg-gray-100"
        >
          <Text className="text-gray-700 font-semibold text-sm">
            {t('alarms.rejectCta')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function AlarmRow({
  alarm,
  summary,
  onDelete,
}: {
  alarm: Alarm;
  summary: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  const renderRightActions = () => (
    <Pressable
      onPress={onDelete}
      className="bg-red-500 justify-center items-center px-6 mr-2 mb-2 rounded-lg"
    >
      <Ionicons name="trash" size={22} color="#fff" />
      <Text className="text-white text-xs font-medium mt-0.5">
        {t('common.delete')}
      </Text>
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <Link href={`/alarm/${alarm.id}` as never} asChild>
        <Pressable
          className={`flex-row items-center bg-white border border-gray-200 rounded-lg px-4 py-3 mb-2 active:bg-gray-50 ${
            !alarm.isActive ? 'opacity-50' : ''
          }`}
        >
          <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center mr-3">
            <Ionicons name={iconFor(alarm)} size={20} color="#2563EB" />
          </View>
          <View className="flex-1">
            <Text
              className="text-base font-semibold text-gray-900"
              numberOfLines={1}
            >
              {alarm.title}
            </Text>
            {summary ? (
              <Text className="text-xs text-gray-500" numberOfLines={1}>
                {summary}
              </Text>
            ) : null}
          </View>
          {!alarm.isActive && (
            <Text className="text-xs text-gray-400 italic ml-2">
              {t('common.paused')}
            </Text>
          )}
        </Pressable>
      </Link>
    </Swipeable>
  );
}

export default function AgendaScreen() {
  const { t, i18n } = useTranslation();
  const { data: alarms, isLoading, error, refetch, isRefetching } = useAlarms();
  const { data: places } = usePlaces();
  const { data: friends } = useFriends();
  const userId = useAuthStore((s) => s.user?.id);
  const deleteAlarm = useDeleteAlarm();
  const acceptAlarm = useAcceptAlarm();
  const rejectAlarm = useRejectAlarm();

  // Pendientes: alarmas en mi agenda creadas por un amigo, esperando mi
  // aceptación. Se muestran en un banner separado al inicio.
  const pendingAlarms = useMemo(() => {
    if (!alarms || !userId) return [];
    return alarms.filter(
      (a) => a.ownerId === userId && a.status === 'pending_acceptance',
    );
  }, [alarms, userId]);

  // Lista principal: solo alarmas de mi agenda no pendientes. Las que yo
  // mismo he creado para amigos viven en el device del amigo y se ocultan
  // aquí para no confundir.
  const sortedAlarms = useMemo(() => {
    if (!alarms || !userId) return [];
    return [...alarms]
      .filter((a) => a.ownerId === userId && a.status !== 'pending_acceptance')
      .sort((a, b) => {
        // Activas primero
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        // Dentro del mismo grupo, las más recientes primero (orden del backend)
        return 0;
      });
  }, [alarms, userId]);

  const creatorNameFor = (creatorId: string): string => {
    const f = (friends ?? []).find((x) => x.friend?.id === creatorId);
    return f?.friend?.name ?? t('alarms.unknownFriend');
  };

  const formatDeps: FormatAlarmDeps = useMemo(
    () => ({
      places: places ?? [],
      lang: i18n.language,
      weekdayInitials: t('alarms.weekdayInitials', {
        returnObjects: true,
      }) as string[],
      every: t('alarms.repeatEveryDay'),
      unknownPlaceLabel: t('alarms.unknownPlace'),
      customPointLabel: t('alarms.customPointLabel'),
      whenLabels: {
        enter: t('alarms.whenEnter'),
        exit: t('alarms.whenExit'),
        nearby: t('alarms.whenNearby'),
      },
    }),
    [places, i18n.language, t],
  );

  const handleDelete = (alarm: Alarm) => {
    Alert.alert(
      t('alarms.deleteConfirmTitle'),
      t('alarms.deleteConfirmBody', { title: alarm.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelAlarmNotificationByAlarmId(alarm.id);
              await deleteAlarm.mutateAsync(alarm.id);
            } catch {
              Alert.alert(t('common.error'), t('alarms.deleteError'));
            }
          },
        },
      ],
    );
  };

  const handleAccept = async (alarm: Alarm) => {
    try {
      const accepted = await acceptAlarm.mutateAsync(alarm.id);
      // Si tiene componente de hora, programar la notificación local ahora
      // (no se hizo antes porque estaba pending_acceptance).
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
      // Si tiene componente de lugar, useGeofenceSync detectará el cambio
      // en el cache de alarmas y registrará el geofence en el siguiente tick.
    } catch {
      Alert.alert(t('common.error'), t('alarms.acceptError'));
    }
  };

  const handleReject = (alarm: Alarm) => {
    Alert.alert(
      t('alarms.rejectConfirmTitle'),
      t('alarms.rejectConfirmBody', { title: alarm.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alarms.rejectCta'),
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectAlarm.mutateAsync(alarm.id);
            } catch {
              Alert.alert(t('common.error'), t('alarms.rejectError'));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-6 pt-2 pb-4">
        <Text className="text-2xl font-bold text-gray-900">{t('tabs.agenda')}</Text>
        <View className="flex-row items-center">
          <Link href={'/sent-alarms' as never} asChild>
            <Pressable
              className="w-10 h-10 rounded-full bg-white border border-gray-200 items-center justify-center mr-2 active:bg-gray-100"
              hitSlop={6}
            >
              <Ionicons name="paper-plane-outline" size={20} color="#374151" />
            </Pressable>
          </Link>
          <Link href={'/alarm/new' as never} asChild>
            <Pressable className="w-10 h-10 rounded-full bg-blue-600 items-center justify-center active:bg-blue-700">
              <Ionicons name="add" size={24} color="#fff" />
            </Pressable>
          </Link>
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#2563EB" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-500 text-center">{t('common.errorLoading')}</Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-4 px-4 py-2 border border-gray-300 rounded-lg active:bg-gray-100"
          >
            <Text className="text-gray-700">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sortedAlarms}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
          renderItem={({ item }) => (
            <AlarmRow
              alarm={item}
              summary={formatAlarmSummary(item, formatDeps)}
              onDelete={() => handleDelete(item)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListHeaderComponent={
            pendingAlarms.length > 0 ? (
              <View className="mb-3">
                <Text className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2 px-1">
                  {t('alarms.pendingSection', { count: pendingAlarms.length })}
                </Text>
                {pendingAlarms.map((a) => (
                  <PendingAlarmCard
                    key={a.id}
                    alarm={a}
                    summary={formatAlarmSummary(a, formatDeps)}
                    creatorName={creatorNameFor(a.creatorId)}
                    onAccept={() => handleAccept(a)}
                    onReject={() => handleReject(a)}
                    busy={acceptAlarm.isPending || rejectAlarm.isPending}
                  />
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            pendingAlarms.length === 0 ? (
              <View className="items-center mt-16 px-6">
                <Ionicons name="alarm-outline" size={48} color="#9CA3AF" />
                <Text className="text-gray-500 text-center mt-3">
                  {t('alarms.empty')}
                </Text>
                <Text className="text-gray-400 text-sm text-center mt-1">
                  {t('alarms.emptyHint')}
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
