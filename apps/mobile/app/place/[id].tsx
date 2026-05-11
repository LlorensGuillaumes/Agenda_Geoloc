import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { type CameraRef } from '@maplibre/maplibre-react-native';
import Slider from '@react-native-community/slider';
import { ApiError } from '@/lib/api/client';
import {
  usePlaces,
  useUpdatePlace,
  useDeletePlace,
} from '@/lib/places/hooks';
import { GeofenceMap, type LatLng } from '@/components/geofence-map';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function PlaceDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const placesQuery = usePlaces();
  const updatePlace = useUpdatePlace();
  const deletePlace = useDeletePlace();
  const cameraRef = useRef<CameraRef>(null);

  const place = placesQuery.data?.find((p) => p.id === id);

  const [name, setName] = useState('');
  const [marker, setMarker] = useState<LatLng>({ latitude: 0, longitude: 0 });
  const [radius, setRadius] = useState(50);
  const [color, setColor] = useState(COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!place) return;
    setName(place.name);
    setMarker({ latitude: place.latitude, longitude: place.longitude });
    setRadius(place.radiusMeters);
    setColor(place.color ?? COLORS[0]);
    cameraRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 15,
      duration: 400,
    });
  }, [place]);

  const handleSave = async () => {
    if (!place) return;
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('places.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await updatePlace.mutateAsync({
        id: place.id,
        data: {
          name: name.trim(),
          latitude: marker.latitude,
          longitude: marker.longitude,
          radiusMeters: radius,
          color,
        },
      });
      router.back();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Unknown';
      Alert.alert(t('common.error'), `${t('places.updateError')}\n${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (!place) return;
    Alert.alert(
      t('places.deleteConfirmTitle'),
      t('places.deleteConfirmBody', { name: place.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deletePlace.mutateAsync(place.id);
              router.back();
            } catch (err) {
              const message =
                err instanceof ApiError
                  ? `HTTP ${err.status}`
                  : err instanceof Error
                    ? err.message
                    : 'Unknown';
              Alert.alert(t('common.error'), `${t('places.deleteError')}\n${message}`);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  if (placesQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (!place) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-6">
        <Stack.Screen options={{ title: t('places.detailTitle'), headerShown: true }} />
        <Ionicons name="alert-circle-outline" size={48} color="#9CA3AF" />
        <Text className="text-lg font-semibold text-gray-900 mt-3">
          {t('places.notFound')}
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

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['bottom']}>
      <Stack.Screen options={{ title: t('places.detailTitle'), headerShown: true }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View style={{ height: 240 }}>
          <GeofenceMap
            ref={cameraRef}
            center={marker}
            radius={radius}
            color={color}
            onPressMap={setMarker}
            initialZoom={15}
          />
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-xs text-gray-500 mb-3">
            {t('places.tapToMove')}
          </Text>

          <Text className="text-sm font-medium text-gray-700 mb-2">
            {t('places.name')}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('places.namePlaceholder')}
            placeholderTextColor="#9CA3AF"
            className="border border-gray-300 rounded-lg px-4 py-3 text-base mb-4"
          />

          <View className="flex-row justify-between mb-1">
            <Text className="text-sm font-medium text-gray-700">
              {t('places.radius')}
            </Text>
            <Text className="text-sm font-semibold text-blue-600">{radius}m</Text>
          </View>
          <Slider
            value={radius}
            minimumValue={20}
            maximumValue={2000}
            step={10}
            onValueChange={setRadius}
            minimumTrackTintColor="#2563EB"
            maximumTrackTintColor="#E5E7EB"
            thumbTintColor="#2563EB"
          />

          <Text className="text-sm font-medium text-gray-700 mt-4 mb-2">
            {t('places.color')}
          </Text>
          <View className="flex-row mb-6">
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                className="mr-3 items-center justify-center"
                hitSlop={6}
              >
                <View
                  className="w-9 h-9 rounded-full items-center justify-center"
                  style={{
                    backgroundColor: c,
                    borderWidth: color === c ? 3 : 0,
                    borderColor: '#111827',
                  }}
                >
                  {color === c && <Ionicons name="checkmark" size={18} color="#fff" />}
                </View>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={handleSave}
            disabled={submitting || deleting}
            className={`rounded-lg py-3 items-center mb-3 ${
              submitting ? 'bg-blue-400' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            <Text className="text-white font-semibold text-base">
              {submitting ? t('common.saving') : t('common.save')}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleDelete}
            disabled={submitting || deleting}
            className="border border-red-300 rounded-lg py-3 items-center active:bg-red-50"
          >
            <Text className="text-red-600 font-semibold text-base">
              {deleting ? t('common.loading') : t('common.delete')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
