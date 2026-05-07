import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-white justify-center px-6">
      <Text className="text-3xl font-bold text-gray-900 mb-4">
        {t('auth.forgot.title')}
      </Text>
      <Text className="text-base text-gray-600 mb-8">
        {t('auth.forgot.comingSoon')}
      </Text>
      <Link href="/(auth)/login">
        <Text className="text-blue-600 font-semibold">
          ← {t('auth.forgot.backToLogin')}
        </Text>
      </Link>
    </View>
  );
}
