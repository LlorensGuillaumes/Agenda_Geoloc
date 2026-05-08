import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useDeletePlace, usePlaces } from '@/lib/places/hooks';
import type { Place } from '@/lib/api/client';

function PlaceRow({
  place,
  onDelete,
}: {
  place: Place;
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
      <Link href={`/place/${place.id}` as never} asChild>
        <Pressable className="flex-row items-center bg-white border border-gray-200 rounded-lg px-4 py-3 mb-2 active:bg-gray-50">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: place.color ?? '#3B82F6' }}
          >
            <Ionicons name="location" size={20} color="#fff" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
              {place.name}
            </Text>
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              {place.address ??
                `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`}
            </Text>
          </View>
          <Text className="text-xs text-gray-400">{place.radiusMeters}m</Text>
        </Pressable>
      </Link>
    </Swipeable>
  );
}

export default function PlacesScreen() {
  const { t } = useTranslation();
  const { data: places, isLoading, error, refetch, isRefetching } = usePlaces();
  const deletePlace = useDeletePlace();

  const handleDelete = (place: Place) => {
    Alert.alert(
      t('places.deleteConfirmTitle'),
      t('places.deleteConfirmBody', { name: place.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlace.mutateAsync(place.id);
            } catch {
              Alert.alert(t('common.error'), t('places.deleteError'));
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-6 pt-2 pb-4">
        <Text className="text-2xl font-bold text-gray-900">{t('tabs.places')}</Text>
        <Link href={'/place/new' as never} asChild>
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
          data={places}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
          renderItem={({ item }) => (
            <PlaceRow place={item} onDelete={() => handleDelete(item)} />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <View className="items-center mt-16 px-6">
              <Ionicons name="location-outline" size={48} color="#9CA3AF" />
              <Text className="text-gray-500 text-center mt-3">
                {t('places.empty')}
              </Text>
              <Text className="text-gray-400 text-sm text-center mt-1">
                {t('places.emptyHint')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
