import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import {
  getGeofenceDiagnostic,
  getLocationPermissionState,
  isGeofencingActive,
  requestLocationPermissions,
  unregisterAllGeofences,
  type LocationPermissionState,
} from '@/lib/geofencing';

type NotifStatus = 'granted' | 'denied' | 'undetermined';

type State = {
  location: LocationPermissionState | null;
  notifications: NotifStatus;
  geofencingActive: boolean;
};

const initialState: State = {
  location: null,
  notifications: 'undetermined',
  geofencingActive: false,
};

export function PermissionsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [state, setState] = useState<State>(initialState);
  const [requesting, setRequesting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [location, notifs, active] = await Promise.all([
        getLocationPermissionState(),
        Notifications.getPermissionsAsync(),
        isGeofencingActive(),
      ]);
      const notifications: NotifStatus = notifs.granted
        ? 'granted'
        : notifs.canAskAgain
          ? 'undetermined'
          : 'denied';
      setState({ location, notifications, geofencingActive: active });
    } catch {
      // En Expo Go las APIs nativas no existen — caemos al estado inicial.
      setState(initialState);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleRequest = async () => {
    setRequesting(true);
    try {
      await requestLocationPermissions();
      const notifs = await Notifications.getPermissionsAsync();
      if (!notifs.granted && notifs.canAskAgain) {
        await Notifications.requestPermissionsAsync();
      }
    } finally {
      await refresh();
      setRequesting(false);
    }
  };

  const allGood =
    !!state.location?.always && state.notifications === 'granted';
  const cantAskBg =
    state.location?.whenInUse &&
    !state.location.always &&
    !state.location.canAskAgainAlways;

  return (
    <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <Text className="text-base font-semibold text-gray-900 mb-3">
        {t('settings.permissions.title')}
      </Text>

      <PermissionRow
        label={t('settings.permissions.locationWhenInUse')}
        ok={!!state.location?.whenInUse}
      />
      <PermissionRow
        label={t('settings.permissions.locationAlways')}
        ok={!!state.location?.always}
      />
      <PermissionRow
        label={t('settings.permissions.notifications')}
        ok={state.notifications === 'granted'}
      />
      <PermissionRow
        label={t('settings.permissions.geofencingActive')}
        ok={state.geofencingActive}
      />

      {!allGood && (
        <View className="mt-3">
          <Pressable
            onPress={handleRequest}
            disabled={requesting}
            className={`rounded-lg py-2 items-center mb-2 ${
              requesting ? 'bg-blue-300' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            <Text className="text-white font-medium">
              {requesting
                ? t('common.loading')
                : t('settings.permissions.requestAlways')}
            </Text>
          </Pressable>
          {cantAskBg && (
            <Pressable
              onPress={() => Linking.openSettings()}
              className="border border-gray-300 rounded-lg py-2 items-center active:bg-gray-100"
            >
              <Text className="text-gray-700">
                {t('settings.permissions.openSystemSettings')}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {!state.location?.always && (
        <Text className="text-xs text-gray-500 mt-3 leading-5">
          {t('settings.permissions.alwaysHelp')}
        </Text>
      )}

      <Pressable
        onPress={async () => {
          const d = await getGeofenceDiagnostic();
          Alert.alert(
            'Diagnòstic geofencing',
            `Geofence task: ${d.geofenceTaskStarted ? '✅' : '❌'}\n` +
              `Location task: ${d.locationTaskStarted ? '✅' : '❌'}\n` +
              `Keepalive alarms: ${d.keepaliveCount}\n` +
              `Cache entries: ${d.geofenceCacheKeys}`,
          );
        }}
        className="mt-3 border border-gray-300 rounded-lg py-2 items-center active:bg-gray-100"
      >
        <Text className="text-xs text-gray-700">Diagnòstic geofencing</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          if (restarting) return;
          setRestarting(true);
          try {
            // Desregistra tot, força que el pròxim sync arrenqui el location
            // task amb el bundle actual del JS.
            await unregisterAllGeofences();
            // Invalida cache d'alarms i places perquè useGeofenceSync detecti
            // un fingerprint nou i torni a cridar syncGeofences.
            await qc.invalidateQueries({ queryKey: ['alarms'] });
            await qc.invalidateQueries({ queryKey: ['places'] });
            await refresh();
            Alert.alert(
              'Reiniciat',
              'Geofencing reiniciat. Espera uns segons i tornarà a aparèixer "Vigilant N llocs".',
            );
          } catch (err) {
            Alert.alert(
              'Error',
              err instanceof Error ? err.message : 'Unknown',
            );
          } finally {
            setRestarting(false);
          }
        }}
        disabled={restarting}
        className={`mt-2 border rounded-lg py-2 items-center ${
          restarting
            ? 'border-gray-200'
            : 'border-amber-300 active:bg-amber-50'
        }`}
      >
        <Text className={`text-xs ${restarting ? 'text-gray-400' : 'text-amber-700'}`}>
          {restarting ? 'Reiniciant…' : 'Reiniciar servei geofencing'}
        </Text>
      </Pressable>
    </View>
  );
}

function PermissionRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="text-sm text-gray-700 flex-1 mr-2">{label}</Text>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'close-circle'}
        size={20}
        color={ok ? '#10B981' : '#EF4444'}
      />
    </View>
  );
}
