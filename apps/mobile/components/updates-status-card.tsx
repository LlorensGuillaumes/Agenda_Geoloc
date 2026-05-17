/**
 * Mostra l'estat de les actualitzacions OTA (Expo Updates) en temps real.
 *
 * - Si comprovant / descarregant, mostra spinner + text
 * - Si hi ha un update llest per aplicar, mostra botó "Aplicar ara"
 *   (Updates.reloadAsync recarrega l'app amb el bundle nou)
 * - També exposa un botó "Comprovar ara" per forçar la comprovació manual
 *
 * És minimal i JS pur — distribuible per OTA. La primera vegada que es
 * desplegui amb el bundle nou, l'usuari ja el veurà; per a sessions futures
 * tindrà visibilitat directa de què està passant amb les actualitzacions.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';

export function UpdatesStatusCard() {
  const { isChecking, isDownloading, isUpdatePending, currentlyRunning } =
    Updates.useUpdates();
  const [manualChecking, setManualChecking] = useState(false);

  const checking = isChecking || manualChecking;

  const handleCheck = async () => {
    setManualChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
        // isUpdatePending passarà a true automàticament via el hook
      } else {
        Alert.alert('Sense actualitzacions', 'Estàs a la versió més recent.');
      }
    } catch (err) {
      Alert.alert(
        'Error',
        `No s'ha pogut comprovar:\n${err instanceof Error ? err.message : 'Unknown'}`,
      );
    } finally {
      setManualChecking(false);
    }
  };

  const handleApply = async () => {
    try {
      await Updates.reloadAsync();
    } catch (err) {
      Alert.alert(
        'Error',
        `No s'ha pogut recarregar:\n${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  };

  const updateId = currentlyRunning.updateId ?? '(embedded)';
  const short = updateId === '(embedded)' ? updateId : updateId.slice(0, 8);

  return (
    <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <Text className="text-base font-semibold text-gray-900 mb-3">
        Actualitzacions
      </Text>

      <View className="flex-row items-center justify-between py-1.5">
        <Text className="text-sm text-gray-700 flex-1 mr-2">Versió app</Text>
        <Text className="text-xs text-gray-500">
          {currentlyRunning.runtimeVersion ?? '?'}
        </Text>
      </View>

      <View className="flex-row items-center justify-between py-1.5">
        <Text className="text-sm text-gray-700 flex-1 mr-2">Bundle</Text>
        <Text className="text-xs text-gray-500">{short}</Text>
      </View>

      {/* Estat actual */}
      <View className="flex-row items-center mt-2 py-1.5">
        {checking ? (
          <>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text className="text-sm text-blue-700 ml-2">
              Comprovant actualitzacions…
            </Text>
          </>
        ) : isDownloading ? (
          <>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text className="text-sm text-blue-700 ml-2">
              Descarregant actualització…
            </Text>
          </>
        ) : isUpdatePending ? (
          <>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <Text className="text-sm text-green-700 ml-2">
              Actualització a punt per aplicar
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="checkmark-circle-outline" size={18} color="#9CA3AF" />
            <Text className="text-sm text-gray-500 ml-2">Versió al dia</Text>
          </>
        )}
      </View>

      {isUpdatePending && (
        <Pressable
          onPress={handleApply}
          className="mt-2 bg-green-600 rounded-lg py-2 items-center active:bg-green-700"
        >
          <Text className="text-white font-medium text-sm">Aplicar ara</Text>
        </Pressable>
      )}

      <Pressable
        onPress={handleCheck}
        disabled={checking || isDownloading}
        className={`mt-2 border rounded-lg py-2 items-center ${
          checking || isDownloading
            ? 'border-gray-200'
            : 'border-gray-300 active:bg-gray-100'
        }`}
      >
        <Text className="text-xs text-gray-700">Comprovar ara</Text>
      </Pressable>
    </View>
  );
}
