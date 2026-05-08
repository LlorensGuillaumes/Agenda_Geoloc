import { useEffect, useState } from 'react';
import {
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
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import MapView, { Marker, Circle, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import {
  ApiError,
  type LocationConfig,
  type Place,
  type TimeConfig,
} from '@/lib/api/client';
import { useCreateAlarm } from '@/lib/alarms/hooks';
import { usePlaces } from '@/lib/places/hooks';
import { scheduleAlarmNotification } from '@/lib/notifications';

type TriggerType = 'time' | 'location' | 'time_and_location';
type LocationMode = 'saved_place' | 'custom_point';
type LocationEvent = 'enter' | 'exit' | 'nearby';

const DEFAULT_REGION: Region = {
  latitude: 41.3851,
  longitude: 2.1734,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function combineDate(dateOnly: Date, source: Date): Date {
  const d = new Date(source);
  d.setFullYear(dateOnly.getFullYear(), dateOnly.getMonth(), dateOnly.getDate());
  return d;
}

function combineTime(timeOnly: Date, source: Date): Date {
  const d = new Date(source);
  d.setHours(timeOnly.getHours(), timeOnly.getMinutes(), 0, 0);
  return d;
}

function formatDate(d: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function formatTime(d: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// ---------- Sub-components ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2 px-1">
        {title}
      </Text>
      {children}
    </View>
  );
}

function TriggerCard({
  selected,
  icon,
  label,
  onPress,
}: {
  selected: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center justify-center py-4 rounded-lg border-2 mx-1 ${
        selected
          ? 'border-blue-600 bg-blue-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <Ionicons
        name={icon}
        size={28}
        color={selected ? '#2563EB' : '#6B7280'}
      />
      <Text
        className={`text-xs mt-2 text-center px-1 font-medium ${
          selected ? 'text-blue-700' : 'text-gray-600'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PillButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 px-3 py-2 rounded-lg border mx-1 items-center ${
        selected
          ? 'bg-blue-600 border-blue-600'
          : 'bg-white border-gray-300'
      }`}
    >
      <Text
        className={`text-sm font-medium ${selected ? 'text-white' : 'text-gray-700'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PlaceChip({
  place,
  selected,
  onPress,
}: {
  place: Place;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-3 py-2 rounded-full mr-2 border ${
        selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'
      }`}
    >
      <View
        className="w-5 h-5 rounded-full mr-2"
        style={{ backgroundColor: place.color ?? '#3B82F6' }}
      />
      <Text className={selected ? 'text-white font-medium' : 'text-gray-700'}>
        {place.name}
      </Text>
    </Pressable>
  );
}

// ---------- Screen ----------

export default function NewAlarmScreen() {
  const { t, i18n } = useTranslation();
  const createAlarm = useCreateAlarm();
  const placesQuery = usePlaces();

  // Generic
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Time
  const [date, setDate] = useState(nextHour());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Location
  const [locationMode, setLocationMode] = useState<LocationMode>('saved_place');
  const [savedPlaceId, setSavedPlaceId] = useState<string | null>(null);
  const [customMarker, setCustomMarker] = useState({
    latitude: DEFAULT_REGION.latitude,
    longitude: DEFAULT_REGION.longitude,
  });
  const [customRadius, setCustomRadius] = useState(50);
  const [event, setEvent] = useState<LocationEvent>('enter');

  const includesTime = triggerType === 'time' || triggerType === 'time_and_location';
  const includesLocation =
    triggerType === 'location' || triggerType === 'time_and_location';

  // Center custom map on user location when first switching to it
  useEffect(() => {
    if (locationMode !== 'custom_point') return;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCustomMarker({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch {
        // sin ubicación, mantenemos default
      }
    })();
  }, [locationMode]);

  const onChangeDate = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setDate((prev) => combineDate(selected, prev));
  };

  const onChangeTime = (_e: DateTimePickerEvent, selected?: Date) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selected) setDate((prev) => combineTime(selected, prev));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert(t('common.error'), t('alarms.titleRequired'));
      return;
    }
    if (!triggerType) {
      Alert.alert(t('common.error'), t('alarms.triggerRequired'));
      return;
    }
    if (includesTime && date.getTime() <= Date.now()) {
      Alert.alert(t('common.error'), t('alarms.dateInPast'));
      return;
    }
    if (includesLocation && locationMode === 'saved_place' && !savedPlaceId) {
      Alert.alert(t('common.error'), t('alarms.placeRequired'));
      return;
    }

    const timeConfig: TimeConfig | undefined = includesTime
      ? { datetime: date.toISOString(), repeat: 'once' }
      : undefined;

    const locationConfig: LocationConfig | undefined = includesLocation
      ? {
          mode: locationMode,
          placeId: locationMode === 'saved_place' ? savedPlaceId! : undefined,
          customPoint:
            locationMode === 'custom_point'
              ? {
                  latitude: customMarker.latitude,
                  longitude: customMarker.longitude,
                  radiusMeters: customRadius,
                }
              : undefined,
          event,
        }
      : undefined;

    setSubmitting(true);
    try {
      const created = await createAlarm.mutateAsync({
        title: title.trim(),
        notes: notes.trim() || undefined,
        triggerType,
        timeConfig,
        locationConfig,
      });

      if (includesTime && timeConfig?.datetime) {
        await scheduleAlarmNotification({
          alarmId: created.id,
          title: created.title,
          body: created.notes ?? undefined,
          datetime: timeConfig.datetime,
        });
      }

      router.back();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `HTTP ${err.status}`
          : err instanceof Error
            ? err.message
            : 'Unknown';
      Alert.alert(t('common.error'), `${t('alarms.createError')}\n${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <Stack.Screen options={{ title: t('alarms.newTitle'), headerShown: true }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title + notes */}
          <Section title={t('alarms.detailsSection')}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('alarms.titlePlaceholder')}
              placeholderTextColor="#9CA3AF"
              className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-base mb-3"
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('alarms.notesPlaceholder')}
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-base"
              style={{ minHeight: 70, textAlignVertical: 'top' }}
            />
          </Section>

          {/* Trigger type */}
          <Section title={t('alarms.triggerSection')}>
            <View className="flex-row -mx-1">
              <TriggerCard
                selected={triggerType === 'time'}
                icon="alarm-outline"
                label={t('alarms.trigger.time')}
                onPress={() => setTriggerType('time')}
              />
              <TriggerCard
                selected={triggerType === 'location'}
                icon="location-outline"
                label={t('alarms.trigger.location')}
                onPress={() => setTriggerType('location')}
              />
              <TriggerCard
                selected={triggerType === 'time_and_location'}
                icon="layers-outline"
                label={t('alarms.trigger.both')}
                onPress={() => setTriggerType('time_and_location')}
              />
            </View>
          </Section>

          {/* Time block */}
          {includesTime && (
            <Section title={t('alarms.timeSection')}>
              <View className="flex-row">
                <Pressable
                  onPress={() => setShowDatePicker(true)}
                  className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-3 mr-2 flex-row items-center"
                >
                  <Ionicons name="calendar-outline" size={18} color="#374151" />
                  <Text className="ml-2 text-gray-900">
                    {formatDate(date, i18n.language)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowTimePicker(true)}
                  className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-3 flex-row items-center"
                >
                  <Ionicons name="time-outline" size={18} color="#374151" />
                  <Text className="ml-2 text-gray-900">
                    {formatTime(date, i18n.language)}
                  </Text>
                </Pressable>
              </View>
              {showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={onChangeDate}
                  minimumDate={new Date()}
                />
              )}
              {showTimePicker && (
                <DateTimePicker
                  value={date}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={onChangeTime}
                />
              )}
            </Section>
          )}

          {/* Location block */}
          {includesLocation && (
            <Section title={t('alarms.locationSection')}>
              <View className="flex-row mb-3 -mx-1">
                <PillButton
                  selected={locationMode === 'saved_place'}
                  label={t('alarms.savedPlace')}
                  onPress={() => setLocationMode('saved_place')}
                />
                <PillButton
                  selected={locationMode === 'custom_point'}
                  label={t('alarms.customPoint')}
                  onPress={() => setLocationMode('custom_point')}
                />
              </View>

              {locationMode === 'saved_place' ? (
                placesQuery.isLoading ? (
                  <Text className="text-gray-500 text-center py-4">
                    {t('common.loading')}
                  </Text>
                ) : (placesQuery.data?.length ?? 0) === 0 ? (
                  <View className="bg-white border border-gray-200 rounded-lg p-4 items-center">
                    <Text className="text-gray-500 text-center mb-2">
                      {t('alarms.noPlacesYet')}
                    </Text>
                    <Pressable
                      onPress={() => router.push('/place/new' as never)}
                      className="px-3 py-2 border border-blue-300 rounded-lg active:bg-blue-50"
                    >
                      <Text className="text-blue-600">
                        {t('alarms.createFirstPlace')}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingVertical: 4 }}
                  >
                    {placesQuery.data!.map((p) => (
                      <PlaceChip
                        key={p.id}
                        place={p}
                        selected={savedPlaceId === p.id}
                        onPress={() => setSavedPlaceId(p.id)}
                      />
                    ))}
                  </ScrollView>
                )
              ) : (
                <View>
                  <View
                    style={{ height: 200 }}
                    className="rounded-lg overflow-hidden border border-gray-200"
                  >
                    <MapView
                      style={{ flex: 1 }}
                      region={{
                        latitude: customMarker.latitude,
                        longitude: customMarker.longitude,
                        latitudeDelta: 0.02,
                        longitudeDelta: 0.02,
                      }}
                      onPress={(e) => setCustomMarker(e.nativeEvent.coordinate)}
                    >
                      <Marker
                        coordinate={customMarker}
                        draggable
                        onDragEnd={(e) =>
                          setCustomMarker(e.nativeEvent.coordinate)
                        }
                      />
                      <Circle
                        center={customMarker}
                        radius={customRadius}
                        fillColor="rgba(37, 99, 235, 0.18)"
                        strokeColor="#2563EB"
                        strokeWidth={2}
                      />
                    </MapView>
                  </View>
                  <View className="flex-row justify-between mt-3 mb-1">
                    <Text className="text-sm font-medium text-gray-700">
                      {t('places.radius')}
                    </Text>
                    <Text className="text-sm font-semibold text-blue-600">
                      {customRadius}m
                    </Text>
                  </View>
                  <Slider
                    value={customRadius}
                    minimumValue={50}
                    maximumValue={2000}
                    step={10}
                    onValueChange={setCustomRadius}
                    minimumTrackTintColor="#2563EB"
                    maximumTrackTintColor="#E5E7EB"
                    thumbTintColor="#2563EB"
                  />
                </View>
              )}

              <Text className="text-xs text-gray-500 mt-3 mb-2 px-1">
                {t('alarms.eventLabel')}
              </Text>
              <View className="flex-row -mx-1">
                <PillButton
                  selected={event === 'enter'}
                  label={t('alarms.eventEnter')}
                  onPress={() => setEvent('enter')}
                />
                <PillButton
                  selected={event === 'exit'}
                  label={t('alarms.eventExit')}
                  onPress={() => setEvent('exit')}
                />
                <PillButton
                  selected={event === 'nearby'}
                  label={t('alarms.eventNearby')}
                  onPress={() => setEvent('nearby')}
                />
              </View>
            </Section>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={submitting || !triggerType || !title.trim()}
            className={`rounded-lg py-3 items-center mt-4 ${
              submitting || !triggerType || !title.trim()
                ? 'bg-blue-300'
                : 'bg-blue-600 active:bg-blue-700'
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
