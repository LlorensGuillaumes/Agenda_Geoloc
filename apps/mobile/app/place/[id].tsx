import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function PlaceDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <Stack.Screen options={{ title: t('places.detailTitle'), headerShown: true }} />
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-xl font-bold text-gray-900 mb-2">
          {t('common.comingSoon')}
        </Text>
        <Text className="text-gray-500 text-center mb-2">id: {id}</Text>
        <Text className="text-gray-500 text-center mb-8">
          {t('places.detailComingSoon')}
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
