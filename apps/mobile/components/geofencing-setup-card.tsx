import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getGeofenceDiagnostic,
  getLocationPermissionState,
  isGeofencingActive,
  requestLocationPermissions,
  unregisterAllGeofences,
  type LocationPermissionState,
} from '@/lib/geofencing';
import {
  getManufacturer,
  openAppDetailSettings,
  openAutostartSettings,
  openMiuiBatterySaver,
  openMiuiOtherPermissions,
  requestIgnoreBatteryOptimization,
} from '@/lib/system-hardening';

type Status = 'ok' | 'todo' | 'unknown';

const MANUAL_ACK_PREFIX = 'setup-ack:';

async function getAck(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MANUAL_ACK_PREFIX + key)) === '1';
  } catch {
    return false;
  }
}

async function setAck(key: string, value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(MANUAL_ACK_PREFIX + key, '1');
    else await AsyncStorage.removeItem(MANUAL_ACK_PREFIX + key);
  } catch {
    // ignore
  }
}

type Row = {
  key: string;
  title: string;
  description: string;
  status: Status;
  action?: { label: string; onPress: () => void | Promise<void> };
  manual?: { onToggle: (next: boolean) => Promise<void>; acked: boolean };
};

export function GeofencingSetupCard() {
  const qc = useQueryClient();
  const manufacturer = Platform.OS === 'android' ? getManufacturer() : 'other';
  const isXiaomi = manufacturer === 'xiaomi';
  const hasAutostart =
    manufacturer === 'xiaomi' ||
    manufacturer === 'huawei' ||
    manufacturer === 'oppo' ||
    manufacturer === 'vivo';

  const [loc, setLoc] = useState<LocationPermissionState | null>(null);
  const [notif, setNotif] = useState<Status>('unknown');
  const [diag, setDiag] = useState<{
    geofenceTaskStarted: boolean;
    locationTaskStarted: boolean;
    trackingTaskStarted: boolean;
    keepaliveCount: number;
  } | null>(null);
  const [ack, setAckState] = useState<{
    battery: boolean;
    autostart: boolean;
    miuiOther: boolean;
    miuiBattery: boolean;
    cadenat: boolean;
  }>({ battery: false, autostart: false, miuiOther: false, miuiBattery: false, cadenat: false });
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [l, n] = await Promise.all([
        getLocationPermissionState(),
        Notifications.getPermissionsAsync(),
      ]);
      setLoc(l);
      setNotif(n.granted ? 'ok' : n.canAskAgain ? 'todo' : 'todo');
      const d = await getGeofenceDiagnostic();
      setDiag({
        geofenceTaskStarted: d.geofenceTaskStarted,
        locationTaskStarted: d.locationTaskStarted,
        trackingTaskStarted: d.trackingTaskStarted,
        keepaliveCount: d.keepaliveCount,
      });
      const [battery, autostart, miuiOther, miuiBattery, cadenat] = await Promise.all([
        getAck('battery'),
        getAck('autostart'),
        getAck('miui-other-perms'),
        getAck('miui-battery'),
        getAck('cadenat'),
      ]);
      setAckState({ battery, autostart, miuiOther, miuiBattery, cadenat });
    } catch {
      // Expo Go fallback
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const toggleAck = async (k: keyof typeof ack, alias: string, next: boolean) => {
    await setAck(alias, next);
    setAckState({ ...ack, [k]: next });
  };

  const rows: Row[] = [];

  // 1. Location
  rows.push({
    key: 'loc-fg',
    title: 'Ubicació en ús',
    description: "Permet llegir la teva ubicació mentre l'app és oberta.",
    status: loc?.whenInUse ? 'ok' : 'todo',
    action: !loc?.whenInUse
      ? { label: 'Sol·licitar', onPress: async () => { await requestLocationPermissions(); await refresh(); } }
      : undefined,
  });
  rows.push({
    key: 'loc-bg',
    title: 'Ubicació sempre (en segon pla)',
    description: 'Imprescindible perquè dispari quan no tens l’app oberta.',
    status: loc?.always ? 'ok' : 'todo',
    action: !loc?.always
      ? { label: loc?.canAskAgainAlways ? 'Sol·licitar' : 'Obrir Ajustos', onPress: async () => {
          if (loc?.canAskAgainAlways) await requestLocationPermissions();
          else await Linking.openSettings();
          await refresh();
        } }
      : undefined,
  });
  rows.push({
    key: 'notif',
    title: 'Notificacions',
    description: 'Per rebre alarmes quan dispari un geofence.',
    status: notif,
    action: notif !== 'ok'
      ? { label: 'Configurar', onPress: async () => { await Notifications.requestPermissionsAsync(); await refresh(); } }
      : undefined,
  });

  // 2. Resistència
  if (Platform.OS === 'android') {
    rows.push({
      key: 'battery',
      title: 'Exempció d’optimització de bateria',
      description: 'Evita que Android suspengui l’app en segon pla.',
      status: ack.battery ? 'ok' : 'unknown',
      action: { label: 'Configurar', onPress: async () => { await requestIgnoreBatteryOptimization(); await toggleAck('battery', 'battery', true); } },
      manual: { acked: ack.battery, onToggle: (v) => toggleAck('battery', 'battery', v) },
    });

    if (hasAutostart) {
      rows.push({
        key: 'autostart',
        title: `Autostart (${manufacturer})`,
        description: `Permet que ${manufacturer} reactivi l’app després d’un kill.`,
        status: ack.autostart ? 'ok' : 'unknown',
        action: { label: 'Obrir pantalla', onPress: async () => {
          const opened = await openAutostartSettings();
          if (!opened) Alert.alert('No s’ha pogut obrir', 'Busca-la manualment a Ajustos.');
        } },
        manual: { acked: ack.autostart, onToggle: (v) => toggleAck('autostart', 'autostart', v) },
      });
    }

    if (isXiaomi) {
      rows.push({
        key: 'miui-other',
        title: 'Altres permisos (MIUI)',
        description: 'Activa "Iniciar en segon pla" i "Pause if not used" desactivat.',
        status: ack.miuiOther ? 'ok' : 'unknown',
        action: { label: 'Obrir pantalla', onPress: async () => {
          const opened = await openMiuiOtherPermissions();
          if (!opened) {
            const fallback = await openAppDetailSettings();
            void fallback;
            Alert.alert('Fallback', 'No hem trobat la pantalla MIUI. Obrim els ajustos de l’app.');
          }
        } },
        manual: { acked: ack.miuiOther, onToggle: (v) => toggleAck('miuiOther', 'miui-other-perms', v) },
      });

      rows.push({
        key: 'miui-battery',
        title: 'Bateria de l’app (MIUI)',
        description: 'Posa-la a "Sense restriccions".',
        status: ack.miuiBattery ? 'ok' : 'unknown',
        action: { label: 'Obrir pantalla', onPress: async () => {
          const opened = await openMiuiBatterySaver();
          if (!opened) await openAppDetailSettings();
        } },
        manual: { acked: ack.miuiBattery, onToggle: (v) => toggleAck('miuiBattery', 'miui-battery', v) },
      });
    }

    rows.push({
      key: 'cadenat',
      title: 'Cadenat a Apps recents',
      description: 'Toca el botó de recents → prem la targeta d’Agenda → activa el cadenat 🔒.',
      status: ack.cadenat ? 'ok' : 'unknown',
      manual: { acked: ack.cadenat, onToggle: (v) => toggleAck('cadenat', 'cadenat', v) },
    });
  }

  return (
    <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <Text className="text-base font-semibold text-gray-900 mb-1">
        Configuració de geofencing
      </Text>
      <Text className="text-xs text-gray-500 mb-4 leading-5">
        Per a una experiència fiable cal aquestes configuracions. Algunes les
        pot comprovar l’app, altres requereixen confirmació manual.
      </Text>

      {rows.map((row) => (
        <SetupRow key={row.key} row={row} />
      ))}

      <View className="mt-4 pt-3 border-t border-gray-100">
        <Text className="text-sm font-semibold text-gray-900 mb-2">Diagnòstic intern</Text>
        <DiagRow label="Geofence task" ok={diag?.geofenceTaskStarted ?? false} />
        <DiagRow label="Location task" ok={diag?.locationTaskStarted ?? false} />
        <DiagRow label="Tracking task" ok={diag?.trackingTaskStarted ?? false} />
        <Text className="text-xs text-gray-500 mt-1">
          Llocs vigilats: {diag?.keepaliveCount ?? 0}
        </Text>

        <Pressable
          onPress={async () => {
            if (restarting) return;
            setRestarting(true);
            try {
              await unregisterAllGeofences();
              await qc.invalidateQueries({ queryKey: ['alarms'] });
              await qc.invalidateQueries({ queryKey: ['places'] });
              await refresh();
              Alert.alert('Reiniciat', 'Espera uns segons.');
            } finally {
              setRestarting(false);
            }
          }}
          disabled={restarting}
          className={`mt-3 border rounded-lg py-2 items-center ${
            restarting ? 'border-gray-200' : 'border-amber-300 active:bg-amber-50'
          }`}
        >
          <Text className={`text-xs ${restarting ? 'text-gray-400' : 'text-amber-700'}`}>
            {restarting ? 'Reiniciant…' : 'Reiniciar servei geofencing'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SetupRow({ row }: { row: Row }) {
  const icon =
    row.status === 'ok' ? (
      <Ionicons name="checkmark-circle" size={20} color="#10B981" />
    ) : row.status === 'todo' ? (
      <Ionicons name="close-circle" size={20} color="#EF4444" />
    ) : (
      <Ionicons name="help-circle" size={20} color="#F59E0B" />
    );

  return (
    <View className="py-2 border-b border-gray-100">
      <View className="flex-row items-start">
        <View className="mr-2 mt-0.5">{icon}</View>
        <View className="flex-1">
          <Text className="text-sm font-medium text-gray-900">{row.title}</Text>
          <Text className="text-xs text-gray-500 mt-0.5 leading-5">{row.description}</Text>
        </View>
      </View>
      <View className="flex-row mt-2 ml-7">
        {row.action && (
          <Pressable
            onPress={row.action.onPress}
            className="border border-blue-300 rounded-md px-3 py-1 mr-2 active:bg-blue-50"
          >
            <Text className="text-xs text-blue-700 font-medium">{row.action.label}</Text>
          </Pressable>
        )}
        {row.manual && (
          <Pressable
            onPress={() => row.manual!.onToggle(!row.manual!.acked)}
            className={`flex-row items-center rounded-md px-3 py-1 ${
              row.manual.acked
                ? 'border border-green-300 bg-green-50'
                : 'border border-gray-300'
            }`}
          >
            <Ionicons
              name={row.manual.acked ? 'checkbox' : 'square-outline'}
              size={14}
              color={row.manual.acked ? '#10B981' : '#6B7280'}
            />
            <Text className={`text-xs ml-1 ${row.manual.acked ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
              {row.manual.acked ? 'Marcat com fet' : 'Ja ho he fet'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DiagRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View className="flex-row items-center py-0.5">
      <Ionicons
        name={ok ? 'checkmark-circle' : 'close-circle'}
        size={16}
        color={ok ? '#10B981' : '#EF4444'}
      />
      <Text className="text-xs text-gray-700 ml-2">{label}</Text>
    </View>
  );
}
