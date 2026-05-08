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
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Circle, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import { ApiError } from '@/lib/api/client';
import { useCreatePlace } from '@/lib/places/hooks';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// Default fallback (centro de Barcelona) si el usuario rechaza el permiso.
const DEFAULT_REGION: Region = {
  latitude: 41.3851,
  longitude: 2.1734,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function NewPlaceScreen() {
  const { t } = useTranslation();
  const createPlace = useCreatePlace();
  const mapRef = useRef<MapView | null>(null);

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [marker, setMarker] = useState({
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  });
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(50);
  const [color, setColor] = useState(COLORS[0]);
  const [locating, setLocating] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const results = await Location.geocodeAsync(q);
      if (results.length === 0) {
        Alert.alert(t('common.error'), t('places.searchNoResults'));
        return;
      }
      const first = results[0];
      const next: Region = {
        latitude: first.latitude,
        longitude: first.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setMarker({ latitude: first.latitude, longitude: first.longitude });
      setRegion(next);
      mapRef.current?.animateToRegion(next, 600);
    } catch {
      Alert.alert(t('common.error'), t('places.searchError'));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocating(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const userRegion: Region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        setRegion(userRegion);
        setMarker({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        mapRef.current?.animateToRegion(userRegion, 600);
      } catch {
        // No location, seguimos con default
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  const handleMapPress = (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setMarker({ latitude, longitude });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('places.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      let address: string | undefined;
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: marker.latitude,
          longitude: marker.longitude,
        });
        if (results[0]) {
          const r = results[0];
          address = [r.street, r.city, r.region].filter(Boolean).join(', ') || undefined;
        }
      } catch {
        // Sin geocoding, no es crítico
      }

      await createPlace.mutateAsync({
        name: name.trim(),
        latitude: marker.latitude,
        longitude: marker.longitude,
        radiusMeters: radius,
        color,
        address,
      });
      router.back();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Unknown';
      Alert.alert(t('common.error'), `${t('places.createError')}\n${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['bottom']}>
      <Stack.Screen options={{ title: t('places.newTitle'), headerShown: true }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-row px-4 py-2 bg-gray-50 border-b border-gray-200">
          <View className="flex-1 flex-row items-center bg-white border border-gray-300 rounded-lg px-3 py-2 mr-2">
            <Ionicons name="search" size={18} color="#6B7280" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              placeholder={t('places.searchPlaceholder')}
              placeholderTextColor="#9CA3AF"
              className="flex-1 ml-2 text-base text-gray-900"
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={6}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={handleSearch}
            disabled={searching || !query.trim()}
            className={`px-4 rounded-lg justify-center ${
              searching || !query.trim() ? 'bg-blue-300' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            {searching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white font-medium">{t('places.search')}</Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 280 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={region}
            onRegionChangeComplete={setRegion}
            onPress={handleMapPress}
            showsUserLocation
          >
            <Marker
              coordinate={marker}
              draggable
              onDragEnd={(e) => setMarker(e.nativeEvent.coordinate)}
              pinColor={color}
            />
            <Circle
              center={marker}
              radius={radius}
              fillColor={`${color}33`}
              strokeColor={color}
              strokeWidth={2}
            />
          </MapView>
          {locating && (
            <View className="absolute top-2 right-2 bg-white/90 rounded-full px-3 py-1 flex-row items-center">
              <ActivityIndicator size="small" color="#2563EB" />
              <Text className="text-xs text-gray-700 ml-2">
                {t('places.locating')}
              </Text>
            </View>
          )}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-xs text-gray-500 mb-3">{t('places.tapToMove')}</Text>

          <Text className="text-sm font-medium text-gray-700 mb-2">
            {t('places.name')}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('places.namePlaceholder')}
            placeholderTextColor="#9CA3AF"
            className="border border-gray-300 rounded-lg px-4 py-3 text-base mb-4"
            autoCapitalize="words"
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
            onPress={handleSubmit}
            disabled={submitting}
            className={`rounded-lg py-3 items-center ${
              submitting ? 'bg-blue-400' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            <Text className="text-white font-semibold text-base">
              {submitting ? t('common.saving') : t('common.save')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
