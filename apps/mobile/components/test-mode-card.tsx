import { useCallback, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  clearTraces,
  getTestModeEnabled,
  setTestModeEnabled,
} from '@/lib/testing/traces';

export function TestModeCard() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getTestModeEnabled().then(setEnabled);
    }, []),
  );

  const handleToggle = async (v: boolean) => {
    setBusy(true);
    try {
      await setTestModeEnabled(v);
      setEnabled(v);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    Alert.alert(
      'Esborrar traces',
      'Eliminarà tots els registres de test guardats al servidor.',
      [
        { text: 'Cancel·lar', style: 'cancel' },
        {
          text: 'Esborrar',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const ok = await clearTraces();
              Alert.alert(
                ok ? 'Esborrat' : 'Error',
                ok ? 'Traces eliminades.' : 'No s\'han pogut esborrar.',
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-gray-900">
            Mode test
          </Text>
          <Text className="text-xs text-gray-500 mt-1">
            Enregistra cada update de localització i l'estat de cada alarma al servidor (cada 5s aprox.). Útil per a diagnosticar comportaments inesperats.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={busy}
          trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
        />
      </View>
      <Pressable
        onPress={handleClear}
        disabled={busy}
        className="mt-3 border border-gray-300 rounded-lg py-2 items-center active:bg-gray-100"
      >
        <Text className="text-xs text-gray-700">Esborra traces servidor</Text>
      </Pressable>
    </View>
  );
}
