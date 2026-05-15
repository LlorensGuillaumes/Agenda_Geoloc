/**
 * Modal que muestra la agenda del teléfono para elegir un contacto.
 *
 * - Lazy load: pide permiso y carga los contactos solo cuando se abre.
 * - Buscador in-memory por nombre o número.
 * - Si el contacto tiene varios teléfonos, se ofrece elegir cuál.
 * - `onPick` recibe `{ name, phone }`. El consumer decide qué hace con eso.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  usePickContact,
  type PickableContact,
} from '@/lib/contacts/usePickContact';

type PickResult = { name: string; phone: string };

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center">
      <Text className="text-blue-700 font-semibold">{initials}</Text>
    </View>
  );
}

export function ContactPickerModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (result: PickResult) => void;
}) {
  const { t } = useTranslation();
  const { state, load, reset } = usePickContact();
  const [query, setQuery] = useState('');

  // Cuando abrimos el modal por primera vez, dispara el load. Al cerrar lo
  // dejamos como está — la próxima vez que abra reaprovechamos la carga.
  useEffect(() => {
    if (visible && state.status === 'idle') {
      load();
    }
    if (!visible) {
      setQuery('');
    }
  }, [visible, state.status, load]);

  const filtered = useMemo<PickableContact[]>(() => {
    if (state.status !== 'ready') return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.contacts;
    return state.contacts.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      return c.phones.some((p) => p.number.replace(/\s/g, '').includes(q));
    });
  }, [state, query]);

  const handlePick = (contact: PickableContact) => {
    if (contact.phones.length === 1) {
      onPick({ name: contact.name, phone: contact.phones[0].number });
      onClose();
      return;
    }
    // Varios teléfonos: pregunta cuál.
    Alert.alert(
      t('contacts.chooseNumberTitle'),
      contact.name,
      [
        ...contact.phones.map((p) => ({
          text: `${p.label ? `${p.label}: ` : ''}${p.number}`,
          onPress: () => {
            onPick({ name: contact.name, phone: p.number });
            onClose();
          },
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
    );
  };

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <Text className="text-lg font-semibold text-gray-900">
            {t('contacts.pickerTitle')}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color="#374151" />
          </Pressable>
        </View>

        <View className="px-4 py-3 bg-white border-b border-gray-200">
          <View className="flex-row items-center bg-gray-100 rounded-lg px-3">
            <Ionicons name="search" size={18} color="#6B7280" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('contacts.searchPlaceholder')}
              placeholderTextColor="#9CA3AF"
              className="flex-1 ml-2 py-2 text-base text-gray-900"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={6}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </Pressable>
            )}
          </View>
        </View>

        {state.status === 'loading' || state.status === 'idle' ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#2563EB" />
            <Text className="text-sm text-gray-500 mt-3">
              {t('contacts.loading')}
            </Text>
          </View>
        ) : state.status === 'denied' ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="lock-closed-outline" size={48} color="#9CA3AF" />
            <Text className="text-base text-gray-700 mt-3 text-center">
              {t('contacts.permissionDenied')}
            </Text>
            {!state.canAskAgain ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                className="mt-4 px-4 py-2 border border-gray-300 rounded-lg active:bg-gray-100"
              >
                <Text className="text-gray-700">
                  {t('contacts.openSystemSettings')}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  reset();
                  load();
                }}
                className="mt-4 px-4 py-2 bg-blue-600 rounded-lg active:bg-blue-700"
              >
                <Text className="text-white font-medium">
                  {t('contacts.tryAgain')}
                </Text>
              </Pressable>
            )}
          </View>
        ) : state.status === 'error' ? (
          <View className="flex-1 items-center justify-center px-6">
            <Ionicons name="alert-circle-outline" size={48} color="#9CA3AF" />
            <Text className="text-sm text-gray-500 mt-3 text-center">
              {state.message}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            ItemSeparatorComponent={() => (
              <View className="h-px bg-gray-200 ml-16" />
            )}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handlePick(item)}
                className="flex-row items-center px-4 py-3 bg-white active:bg-gray-100"
              >
                <Avatar name={item.name} />
                <View className="flex-1 ml-3">
                  <Text className="text-base text-gray-900" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text className="text-xs text-gray-500" numberOfLines={1}>
                    {item.phones[0].number}
                    {item.phones.length > 1
                      ? ` · +${item.phones.length - 1}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <View className="items-center mt-16 px-6">
                <Ionicons name="person-outline" size={36} color="#9CA3AF" />
                <Text className="text-sm text-gray-500 mt-3 text-center">
                  {query
                    ? t('contacts.noResults')
                    : t('contacts.empty')}
                </Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
