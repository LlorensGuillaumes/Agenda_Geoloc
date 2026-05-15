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
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';
import {
  ApiError,
  type ActiveWindow,
  type LocationConfig,
  type NotifyAction,
  type NotifyConfig,
  type Place,
  type TimeConfig,
} from '@/lib/api/client';
import { useCreateAlarm } from '@/lib/alarms/hooks';
import { usePlaces, useSharedWithMePlaces } from '@/lib/places/hooks';
import { useFriends } from '@/lib/friends/hooks';
import { scheduleAlarmNotification } from '@/lib/notifications';
import { GeofenceMap, type LatLng } from '@/components/geofence-map';
import { ContactPickerModal } from '@/components/contact-picker-modal';

type TriggerType = 'time' | 'location' | 'time_and_location';
type LocationMode = 'saved_place' | 'custom_point';
type LocationEvent = 'enter' | 'exit' | 'nearby';
type RepeatMode = 'once' | 'daily' | 'weekly';

// Render order: lunes a domingo. Values son JS Date.getDay() (0=Sunday).
const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;

const DEFAULT_CENTER: LatLng = { latitude: 41.3851, longitude: 2.1734 };

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

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
  const friendsQuery = useFriends();
  const sharedPlacesQuery = useSharedWithMePlaces();

  // Generic
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Para qué amigo (null = mi propia agenda). Cuando se elige un amigo, los
  // lugares disponibles son los que ese amigo me ha compartido y las
  // notificaciones locales NO se programan (las gestiona el device del owner).
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isCrossAgenda = ownerId !== null;

  // Time
  const [date, setDate] = useState(nextHour());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('once');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  // Location
  const [locationMode, setLocationMode] = useState<LocationMode>('saved_place');
  const [savedPlaceId, setSavedPlaceId] = useState<string | null>(null);
  const [customMarker, setCustomMarker] = useState<LatLng>(DEFAULT_CENTER);
  const [customRadius, setCustomRadius] = useState(50);
  const [event, setEvent] = useState<LocationEvent>('enter');
  // Por defecto la alarma de lugar es de un solo uso (se desactiva al disparar).
  const [locationRepeat, setLocationRepeat] = useState<'once' | 'always'>('once');

  // Acción al disparar: contacto + botones de llamada/WhatsApp en la notif.
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [actionCall, setActionCall] = useState(true);
  const [actionWhatsApp, setActionWhatsApp] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);

  // Active window (opcional): solo dispara dentro de horario/días
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState(() => {
    const d = new Date();
    d.setHours(14, 0, 0, 0);
    return d;
  });
  const [windowEnd, setWindowEnd] = useState(() => {
    const d = new Date();
    d.setHours(22, 0, 0, 0);
    return d;
  });
  const [windowWeekdays, setWindowWeekdays] = useState<number[]>([]);
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);

  const includesTime = triggerType === 'time' || triggerType === 'time_and_location';
  const includesLocation =
    triggerType === 'location' || triggerType === 'time_and_location';

  // Lugares que se ofrecen en el selector según el owner elegido.
  const visiblePlaces: Place[] = isCrossAgenda
    ? (sharedPlacesQuery.data ?? []).filter((p) => p.ownerId === ownerId)
    : (placesQuery.data ?? []);
  const visiblePlacesLoading = isCrossAgenda
    ? sharedPlacesQuery.isLoading
    : placesQuery.isLoading;

  const friends = friendsQuery.data ?? [];
  const selectedFriendName = isCrossAgenda
    ? friends.find((f) => f.friend?.id === ownerId)?.friend?.name
    : undefined;

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
    if (includesTime && repeat === 'once' && date.getTime() <= Date.now()) {
      Alert.alert(t('common.error'), t('alarms.dateInPast'));
      return;
    }
    if (includesTime && repeat === 'weekly' && weekdays.length === 0) {
      Alert.alert(t('common.error'), t('alarms.weekdayRequired'));
      return;
    }
    if (includesLocation && locationMode === 'saved_place' && !savedPlaceId) {
      Alert.alert(t('common.error'), t('alarms.placeRequired'));
      return;
    }

    const timeConfig: TimeConfig | undefined = includesTime
      ? {
          datetime: date.toISOString(),
          repeat,
          weekdays: repeat === 'weekly' ? weekdays : undefined,
        }
      : undefined;

    const activeWindow: ActiveWindow | undefined =
      includesLocation && windowEnabled
        ? {
            start: hhmm(windowStart),
            end: hhmm(windowEnd),
            weekdays: windowWeekdays.length > 0 ? windowWeekdays : undefined,
          }
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
          repeat: locationRepeat,
          activeWindow,
        }
      : undefined;

    const notifyActions: NotifyAction[] = [];
    if (notifyEnabled && actionCall) notifyActions.push('call');
    if (notifyEnabled && actionWhatsApp) notifyActions.push('whatsapp');
    const trimmedPhone = contactPhone.trim();
    const notifyConfig: NotifyConfig | undefined =
      notifyEnabled && trimmedPhone && notifyActions.length > 0
        ? {
            contactName: contactName.trim() || undefined,
            contactPhone: trimmedPhone,
            actions: notifyActions,
            whatsappMessage: actionWhatsApp
              ? whatsappMessage.trim() || undefined
              : undefined,
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
        notifyConfig,
        ownerId: ownerId ?? undefined,
      });

      // Solo programamos la notificación local cuando la alarma es para
      // nosotros. Si es para un amigo, la gestionará el device del owner.
      if (!isCrossAgenda && includesTime && timeConfig) {
        await scheduleAlarmNotification({
          alarmId: created.id,
          title: created.title,
          body: created.notes ?? undefined,
          timeConfig,
          notifyConfig: created.notifyConfig,
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

          {/* For whom (cross-agenda) — solo si tienes amigos */}
          {friends.length > 0 && (
            <Section title={t('alarms.forWhomSection')}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
              >
                <Pressable
                  onPress={() => {
                    setOwnerId(null);
                    setSavedPlaceId(null);
                  }}
                  className={`flex-row items-center px-3 py-2 rounded-full mr-2 border ${
                    !isCrossAgenda
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  <Ionicons
                    name="person"
                    size={14}
                    color={!isCrossAgenda ? '#fff' : '#374151'}
                  />
                  <Text
                    className={`ml-2 ${
                      !isCrossAgenda ? 'text-white font-medium' : 'text-gray-700'
                    }`}
                  >
                    {t('alarms.forMyself')}
                  </Text>
                </Pressable>
                {friends.map((f) =>
                  f.friend ? (
                    <Pressable
                      key={f.id}
                      onPress={() => {
                        setOwnerId(f.friend!.id);
                        setSavedPlaceId(null);
                      }}
                      className={`flex-row items-center px-3 py-2 rounded-full mr-2 border ${
                        ownerId === f.friend.id
                          ? 'bg-blue-600 border-blue-600'
                          : 'bg-white border-gray-300'
                      }`}
                    >
                      <Ionicons
                        name="person-outline"
                        size={14}
                        color={ownerId === f.friend.id ? '#fff' : '#374151'}
                      />
                      <Text
                        className={`ml-2 ${
                          ownerId === f.friend.id
                            ? 'text-white font-medium'
                            : 'text-gray-700'
                        }`}
                      >
                        {f.friend.name}
                      </Text>
                    </Pressable>
                  ) : null,
                )}
              </ScrollView>
              {isCrossAgenda && (
                <Text className="text-xs text-gray-500 mt-2 px-1">
                  {t('alarms.crossAgendaHint', { name: selectedFriendName ?? '' })}
                </Text>
              )}
            </Section>
          )}

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
                {repeat === 'once' && (
                  <Pressable
                    onPress={() => setShowDatePicker(true)}
                    className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-3 mr-2 flex-row items-center"
                  >
                    <Ionicons name="calendar-outline" size={18} color="#374151" />
                    <Text className="ml-2 text-gray-900">
                      {formatDate(date, i18n.language)}
                    </Text>
                  </Pressable>
                )}
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

              <Text className="text-xs text-gray-500 mt-4 mb-2 px-1">
                {t('alarms.repeatLabel')}
              </Text>
              <View className="flex-row -mx-1">
                <PillButton
                  selected={repeat === 'once'}
                  label={t('alarms.repeatOnce')}
                  onPress={() => setRepeat('once')}
                />
                <PillButton
                  selected={repeat === 'daily'}
                  label={t('alarms.repeatDaily')}
                  onPress={() => setRepeat('daily')}
                />
                <PillButton
                  selected={repeat === 'weekly'}
                  label={t('alarms.repeatWeekly')}
                  onPress={() => setRepeat('weekly')}
                />
              </View>

              {repeat === 'weekly' && (
                <View className="mt-3">
                  <Text className="text-xs text-gray-500 mb-2 px-1">
                    {t('alarms.weekdaysLabel')}
                  </Text>
                  <View className="flex-row justify-between">
                    {WEEKDAY_VALUES.map((day, i) => {
                      const labels = t('alarms.weekdayInitials', {
                        returnObjects: true,
                      }) as string[];
                      const selected = weekdays.includes(day);
                      return (
                        <Pressable
                          key={day}
                          onPress={() =>
                            setWeekdays((prev) =>
                              prev.includes(day)
                                ? prev.filter((d) => d !== day)
                                : [...prev, day],
                            )
                          }
                          className={`w-10 h-10 rounded-full items-center justify-center ${
                            selected
                              ? 'bg-blue-600'
                              : 'bg-white border border-gray-300'
                          }`}
                        >
                          <Text
                            className={
                              selected
                                ? 'text-white font-medium'
                                : 'text-gray-700'
                            }
                          >
                            {labels[i]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
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
                visiblePlacesLoading ? (
                  <Text className="text-gray-500 text-center py-4">
                    {t('common.loading')}
                  </Text>
                ) : visiblePlaces.length === 0 ? (
                  <View className="bg-white border border-gray-200 rounded-lg p-4 items-center">
                    <Text className="text-gray-500 text-center mb-2">
                      {isCrossAgenda
                        ? t('alarms.noSharedPlacesFromFriend')
                        : t('alarms.noPlacesYet')}
                    </Text>
                    {!isCrossAgenda && (
                      <Pressable
                        onPress={() => router.push('/place/new' as never)}
                        className="px-3 py-2 border border-blue-300 rounded-lg active:bg-blue-50"
                      >
                        <Text className="text-blue-600">
                          {t('alarms.createFirstPlace')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingVertical: 4 }}
                  >
                    {visiblePlaces.map((p) => (
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
                    <GeofenceMap
                      center={customMarker}
                      radius={customRadius}
                      onPressMap={setCustomMarker}
                      initialZoom={13}
                    />
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
                    minimumValue={20}
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

              {/* Repetir (por defecto se desactiva tras disparar) */}
              <View className="mt-4">
                <Pressable
                  onPress={() =>
                    setLocationRepeat((v) => (v === 'always' ? 'once' : 'always'))
                  }
                  className="flex-row items-center justify-between px-1 py-2"
                >
                  <View className="flex-1 mr-3">
                    <Text className="text-sm font-medium text-gray-700">
                      {t('alarms.repeatAlwaysLabel')}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-1">
                      {t('alarms.repeatAlwaysHint')}
                    </Text>
                  </View>
                  <View
                    className={`w-12 h-7 rounded-full justify-center px-1 ${
                      locationRepeat === 'always' ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <View
                      className={`w-5 h-5 bg-white rounded-full ${
                        locationRepeat === 'always' ? 'self-end' : 'self-start'
                      }`}
                    />
                  </View>
                </Pressable>
              </View>

              {/* Active window (solo activa la alarma dentro de un horario) */}
              <View className="mt-4">
                <Pressable
                  onPress={() => setWindowEnabled((v) => !v)}
                  className="flex-row items-center justify-between px-1 py-2"
                >
                  <View className="flex-1 mr-3">
                    <Text className="text-sm font-medium text-gray-700">
                      {t('alarms.activeWindowLabel')}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-1">
                      {t('alarms.activeWindowHint')}
                    </Text>
                  </View>
                  <View
                    className={`w-12 h-7 rounded-full justify-center px-1 ${
                      windowEnabled ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <View
                      className={`w-5 h-5 bg-white rounded-full ${
                        windowEnabled ? 'self-end' : 'self-start'
                      }`}
                    />
                  </View>
                </Pressable>

                {windowEnabled && (
                  <View className="mt-2">
                    <View className="flex-row">
                      <Pressable
                        onPress={() => setShowWindowStartPicker(true)}
                        className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-3 mr-2 flex-row items-center"
                      >
                        <Ionicons name="time-outline" size={18} color="#374151" />
                        <Text className="ml-2 text-gray-900">
                          {t('alarms.from')} {hhmm(windowStart)}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setShowWindowEndPicker(true)}
                        className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-3 flex-row items-center"
                      >
                        <Ionicons name="time-outline" size={18} color="#374151" />
                        <Text className="ml-2 text-gray-900">
                          {t('alarms.to')} {hhmm(windowEnd)}
                        </Text>
                      </Pressable>
                    </View>
                    {showWindowStartPicker && (
                      <DateTimePicker
                        value={windowStart}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(_e, sel) => {
                          setShowWindowStartPicker(Platform.OS === 'ios');
                          if (sel) setWindowStart(sel);
                        }}
                      />
                    )}
                    {showWindowEndPicker && (
                      <DateTimePicker
                        value={windowEnd}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(_e, sel) => {
                          setShowWindowEndPicker(Platform.OS === 'ios');
                          if (sel) setWindowEnd(sel);
                        }}
                      />
                    )}

                    <Text className="text-xs text-gray-500 mt-3 mb-2 px-1">
                      {t('alarms.activeWindowDaysLabel')}
                    </Text>
                    <View className="flex-row justify-between">
                      {WEEKDAY_VALUES.map((day, i) => {
                        const labels = t('alarms.weekdayInitials', {
                          returnObjects: true,
                        }) as string[];
                        const selected = windowWeekdays.includes(day);
                        return (
                          <Pressable
                            key={day}
                            onPress={() =>
                              setWindowWeekdays((prev) =>
                                prev.includes(day)
                                  ? prev.filter((d) => d !== day)
                                  : [...prev, day],
                              )
                            }
                            className={`w-10 h-10 rounded-full items-center justify-center ${
                              selected
                                ? 'bg-blue-600'
                                : 'bg-white border border-gray-300'
                            }`}
                          >
                            <Text
                              className={
                                selected ? 'text-white font-medium' : 'text-gray-700'
                              }
                            >
                              {labels[i]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            </Section>
          )}

          {/* Avisar un contacte al disparar (call / WhatsApp) */}
          <Section title={t('alarms.notifyContactSection')}>
            <Pressable
              onPress={() => setNotifyEnabled((v) => !v)}
              className="flex-row items-center justify-between px-1 py-2"
            >
              <View className="flex-1 mr-3">
                <Text className="text-sm font-medium text-gray-700">
                  {t('alarms.notifyContactLabel')}
                </Text>
                <Text className="text-xs text-gray-500 mt-1">
                  {t('alarms.notifyContactHint')}
                </Text>
              </View>
              <View
                className={`w-12 h-7 rounded-full justify-center px-1 ${
                  notifyEnabled ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <View
                  className={`w-5 h-5 bg-white rounded-full ${
                    notifyEnabled ? 'self-end' : 'self-start'
                  }`}
                />
              </View>
            </Pressable>

            {notifyEnabled && (
              <View className="mt-2">
                <TextInput
                  value={contactName}
                  onChangeText={setContactName}
                  placeholder={t('alarms.contactNamePlaceholder')}
                  placeholderTextColor="#9CA3AF"
                  className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-base mb-2"
                />
                <TextInput
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder={t('alarms.contactPhonePlaceholder')}
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-base mb-2"
                />

                <Pressable
                  onPress={() => setContactPickerOpen(true)}
                  className="flex-row items-center justify-center border border-blue-300 rounded-lg py-2 mb-3 active:bg-blue-50"
                >
                  <Ionicons name="people-outline" size={18} color="#2563EB" />
                  <Text className="text-blue-600 font-medium ml-2">
                    {t('alarms.pickFromContacts')}
                  </Text>
                </Pressable>

                <View className="flex-row -mx-1 mb-2">
                  <PillButton
                    selected={actionCall}
                    label={t('alarms.actionCall')}
                    onPress={() => setActionCall((v) => !v)}
                  />
                  <PillButton
                    selected={actionWhatsApp}
                    label={t('alarms.actionWhatsApp')}
                    onPress={() => setActionWhatsApp((v) => !v)}
                  />
                </View>

                {actionWhatsApp && (
                  <TextInput
                    value={whatsappMessage}
                    onChangeText={setWhatsappMessage}
                    placeholder={t('alarms.whatsappMessagePlaceholder')}
                    placeholderTextColor="#9CA3AF"
                    multiline
                    className="bg-white border border-gray-300 rounded-lg px-4 py-3 text-base"
                    style={{ minHeight: 60, textAlignVertical: 'top' }}
                  />
                )}
              </View>
            )}
          </Section>

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

      <ContactPickerModal
        visible={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        onPick={({ name, phone }) => {
          setContactName(name);
          setContactPhone(phone);
        }}
      />
    </SafeAreaView>
  );
}
