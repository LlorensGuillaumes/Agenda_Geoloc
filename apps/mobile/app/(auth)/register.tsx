import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@agenda/shared';
import { useAuthStore } from '@/lib/auth/store';
import { ApiError } from '@/lib/api/client';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const signUp = useAuthStore((s) => s.signUp);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    setServerError(null);
    try {
      await signUp(values);
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof ApiError) {
        const message =
          (err.payload as { message?: string } | null)?.message ?? '';
        if (err.status === 422 || /already/i.test(message) || /exist/i.test(message)) {
          setServerError(t('auth.errors.emailTaken'));
          return;
        }
      }
      setServerError(t('auth.errors.generic'));
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-6 py-8">
          <Text className="text-3xl font-bold text-gray-900 mb-2">
            {t('auth.register.title')}
          </Text>
          <Text className="text-base text-gray-500 mb-8">
            {t('auth.register.subtitle')}
          </Text>

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              {t('auth.register.name')}
            </Text>
            <Controller
              control={control}
              name="name"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900"
                  placeholder="Jordi"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="words"
                  onChangeText={onChange}
                  onBlur={onBlur}
                  value={value}
                />
              )}
            />
            {errors.name && (
              <Text className="text-red-500 text-sm mt-1">{errors.name.message}</Text>
            )}
          </View>

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              {t('auth.register.email')}
            </Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900"
                  placeholder="tu@email.com"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={onChange}
                  onBlur={onBlur}
                  value={value}
                />
              )}
            />
            {errors.email && (
              <Text className="text-red-500 text-sm mt-1">{errors.email.message}</Text>
            )}
          </View>

          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              {t('auth.register.password')}
            </Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900"
                  placeholder="••••••••"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry
                  onChangeText={onChange}
                  onBlur={onBlur}
                  value={value}
                />
              )}
            />
            {errors.password && (
              <Text className="text-red-500 text-sm mt-1">{errors.password.message}</Text>
            )}
          </View>

          {serverError && (
            <Text className="text-red-500 text-sm mb-4 text-center">{serverError}</Text>
          )}

          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className={`rounded-lg py-3 items-center ${
              isSubmitting ? 'bg-blue-400' : 'bg-blue-600 active:bg-blue-700'
            }`}
          >
            <Text className="text-white font-semibold text-base">
              {isSubmitting ? t('auth.register.submitting') : t('auth.register.submit')}
            </Text>
          </Pressable>

          <View className="flex-row justify-center mt-6">
            <Text className="text-gray-600">{t('auth.register.hasAccount')} </Text>
            <Link href="/(auth)/login">
              <Text className="text-blue-600 font-semibold">
                {t('auth.register.goToLogin')}
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
