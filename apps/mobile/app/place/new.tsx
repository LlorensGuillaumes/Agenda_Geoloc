import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

export default function NewPlaceScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView className="flex-1 bg-white">
      <Stack.Screen options={{ title: t('places.newTitle'), headerShown: true }} />
      <View className="flex-1 items-center justify-center px-6">
        <Ionicons name="construct-outline" size={48} color="#9CA3AF" />
        <Text className="text-xl font-bold text-gray-900 mt-4 mb-2">
          {t('common.comingSoon')}
        </Text>
        <Text className="text-gray-500 text-center mb-8">
          {t('places.newComingSoon')}
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="px-4 py-2 border border-gray-300 rounded-lg active:bg-gray-100"
        >
          <Text className="text-gray-700">{t('common.back')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
