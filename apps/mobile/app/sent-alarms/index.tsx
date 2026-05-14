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
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAlarms, useDeleteAlarm } from '@/lib/alarms/hooks';
import { usePlaces, useSharedWithMePlaces } from '@/lib/places/hooks';
import { useFriends } from '@/lib/friends/hooks';
import { useAuthStore } from '@/lib/auth/store';
import { formatAlarmSummary, type FormatAlarmDeps } from '@/lib/alarms/format';
import type { Alarm, Place } from '@/lib/api/client';

function iconFor(alarm: Alarm): keyof typeof Ionicons.glyphMap {
  if (alarm.triggerType === 'time') return 'alarm';
  if (alarm.triggerType === 'location') return 'location';
  return 'layers';
}

function SentAlarmRow({
  alarm,
  summary,
  ownerName,
  onDelete,
}: {
  alarm: Alarm;
  summary: string;
  ownerName: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const pending = alarm.status === 'pending_acceptance';

  return (
    <View
      className={`flex-row items-center bg-white border rounded-lg px-4 py-3 mb-2 ${
        pending ? 'border-amber-300' : 'border-gray-200'
      }`}
    >
      <View
        className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
          pending ? 'bg-amber-100' : 'bg-blue-100'
        }`}
      >
        <Ionicons
          name={iconFor(alarm)}
          size={20}
          color={pending ? '#D97706' : '#2563EB'}
        />
      </View>
      <View className="flex-1 mr-2">
        <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
          {alarm.title}
        </Text>
        {summary ? (
          <Text className="text-xs text-gray-500" numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
        <Text className="text-xs text-gray-600 mt-0.5">
          {t('alarms.sentTo', { name: ownerName })} ·{' '}
          {pending ? t('alarms.statusPending') : t('alarms.statusActive')}
        </Text>
      </View>
      <Pressable onPress={onDelete} className="p-2" hitSlop={6}>
        <Ionicons name="trash-outline" size={20} color="#DC2626" />
      </Pressable>
    </View>
  );
}

export default function SentAlarmsScreen() {
  const { t, i18n } = useTranslation();
  const { data: alarms, isLoading, refetch, isRefetching } = useAlarms();
  const { data: places } = usePlaces();
  const { data: sharedPlaces } = useSharedWithMePlaces();
  const { data: friends } = useFriends();
  const userId = useAuthStore((s) => s.user?.id);
  const deleteAlarm = useDeleteAlarm();

  const sentAlarms = useMemo(() => {
    if (!alarms || !userId) return [];
    return alarms.filter(
      (a) => a.creatorId === userId && a.ownerId !== userId,
    );
  }, [alarms, userId]);

  // Para los summaries cross-agenda, junta los lugares propios + los
  // compartidos conmigo (los segundos suelen ser los referenciados, pero
  // ambos son posibles si el creator también compartió alguno suyo).
  const placesUnion: Place[] = useMemo(() => {
    const own = places ?? [];
    const shared = sharedPlaces ?? [];
    // De-dup por id manteniendo el primero.
    const seen = new Set<string>();
    const result: Place[] = [];
    for (const p of [...own, ...shared]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        result.push(p);
      }
    }
    return result;
  }, [places, sharedPlaces]);

  const formatDeps: FormatAlarmDeps = useMemo(
    () => ({
      places: placesUnion,
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
    [placesUnion, i18n.language, t],
  );

  const ownerNameFor = (ownerId: string): string => {
    const f = (friends ?? []).find((x) => x.friend?.id === ownerId);
    return f?.friend?.name ?? t('alarms.unknownFriend');
  };

  const handleDelete = (alarm: Alarm) => {
    Alert.alert(
      t('alarms.withdrawConfirmTitle'),
      t('alarms.withdrawConfirmBody', {
        title: alarm.title,
        name: ownerNameFor(alarm.ownerId),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alarms.withdrawCta'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAlarm.mutateAsync(alarm.id);
            } catch {
              Alert.alert(t('common.error'), t('alarms.deleteError'));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <Stack.Screen options={{ title: t('alarms.sentTitle') }} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#2563EB" />
        </View>
      ) : (
        <FlatList
          data={sentAlarms}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <SentAlarmRow
              alarm={item}
              summary={formatAlarmSummary(item, formatDeps)}
              ownerName={ownerNameFor(item.ownerId)}
              onDelete={() => handleDelete(item)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <View className="items-center mt-16 px-6">
              <Ionicons name="paper-plane-outline" size={48} color="#9CA3AF" />
              <Text className="text-gray-500 text-center mt-3">
                {t('alarms.sentEmpty')}
              </Text>
              <Text className="text-gray-400 text-sm text-center mt-1">
                {t('alarms.sentEmptyHint')}
              </Text>
            </View>
          }
          ListHeaderComponent={
            sentAlarms.length > 0 ? (
              <Text className="text-xs text-gray-500 mb-3 px-1">
                {t('alarms.sentHint')}
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
