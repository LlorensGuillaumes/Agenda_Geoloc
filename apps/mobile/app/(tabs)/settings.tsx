import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth/store';
import { PermissionsCard } from '@/components/permissions-card';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="px-6 pt-2 pb-4">
        <Text className="text-2xl font-bold text-gray-900">{t('tabs.settings')}</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      >
        <View className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-12 h-12 rounded-full bg-blue-100 items-center justify-center mr-3">
              <Ionicons name="person" size={24} color="#2563EB" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900">
                {user?.name}
              </Text>
              <Text className="text-sm text-gray-500">{user?.email}</Text>
            </View>
          </View>
          <Text className="text-xs text-gray-400">
            {t('settings.language')}: {i18n.language.toUpperCase()}
          </Text>
        </View>

        <PermissionsCard />

        <Pressable
          onPress={() => signOut()}
          className="border border-red-300 bg-white rounded-lg py-3 items-center active:bg-red-50"
        >
          <Text className="text-red-600 font-semibold">{t('auth.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
