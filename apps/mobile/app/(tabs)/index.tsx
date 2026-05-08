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
import { useAlarms, useDeleteAlarm } from '@/lib/alarms/hooks';
import { usePlaces } from '@/lib/places/hooks';
import { formatAlarmSummary, type FormatAlarmDeps } from '@/lib/alarms/format';
import { cancelAlarmNotificationByAlarmId } from '@/lib/notifications';
import type { Alarm } from '@/lib/api/client';

function iconFor(alarm: Alarm): keyof typeof Ionicons.glyphMap {
  if (alarm.triggerType === 'time') return 'alarm';
  if (alarm.triggerType === 'location') return 'location';
  return 'layers';
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
  const deleteAlarm = useDeleteAlarm();

  const sortedAlarms = useMemo(() => {
    if (!alarms) return [];
    return [...alarms].sort((a, b) => {
      // Activas primero
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      // Dentro del mismo grupo, las más recientes primero (orden del backend)
      return 0;
    });
  }, [alarms]);

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

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-6 pt-2 pb-4">
        <Text className="text-2xl font-bold text-gray-900">{t('tabs.agenda')}</Text>
        <Link href={'/alarm/new' as never} asChild>
          <Pressable className="w-10 h-10 rounded-full bg-blue-600 items-center justify-center active:bg-blue-700">
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </Link>
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
          ListEmptyComponent={
            <View className="items-center mt-16 px-6">
              <Ionicons name="alarm-outline" size={48} color="#9CA3AF" />
              <Text className="text-gray-500 text-center mt-3">
                {t('alarms.empty')}
              </Text>
              <Text className="text-gray-400 text-sm text-center mt-1">
                {t('alarms.emptyHint')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
