import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth/store';

export default function HomeScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-gray-900 mb-1">
          {t('home.greeting', { name: user?.name ?? '' })}
        </Text>
        <Text className="text-sm text-gray-500 mb-8">{user?.email}</Text>

        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-400 text-center">{t('home.placeholder')}</Text>
        </View>

        <Pressable
          onPress={() => signOut()}
          className="border border-red-300 rounded-lg py-3 items-center mb-4 active:bg-red-50"
        >
          <Text className="text-red-600 font-semibold">{t('auth.logout')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
