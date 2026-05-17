import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/auth/store';
import { PermissionsCard } from '@/components/permissions-card';
import { UpdatesStatusCard } from '@/components/updates-status-card';
import { useFriendRequests } from '@/lib/friends/hooks';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const requests = useFriendRequests();
  const incomingCount = (requests.data ?? []).filter(
    (r) => r.direction === 'incoming',
  ).length;

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

        <Link href={'/friends' as never} asChild>
          <Pressable className="bg-white rounded-lg border border-gray-200 px-4 py-3 mb-4 flex-row items-center active:bg-gray-50">
            <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center mr-3">
              <Ionicons name="people" size={20} color="#2563EB" />
            </View>
            <Text className="flex-1 text-base font-semibold text-gray-900">
              {t('friends.title')}
            </Text>
            {incomingCount > 0 && (
              <View className="bg-red-500 rounded-full px-2 py-0.5 mr-2 min-w-[24px] items-center">
                <Text className="text-white text-xs font-bold">{incomingCount}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          </Pressable>
        </Link>

        <PermissionsCard />

        <UpdatesStatusCard />

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
