import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@agenda/shared';
import { useAuthStore } from '@/lib/auth/store';
import { ApiError } from '@/lib/api/client';

export default function LoginScreen() {
  const { t } = useTranslation();
  const signIn = useAuthStore((s) => s.signIn);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    setServerError(null);
    try {
      await signIn(values);
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setServerError(t('auth.errors.invalidCredentials'));
      } else {
        setServerError(t('auth.errors.generic'));
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-white"
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-gray-900 mb-2">
          {t('auth.login.title')}
        </Text>
        <Text className="text-base text-gray-500 mb-8">
          {t('auth.login.subtitle')}
        </Text>

        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 mb-2">
            {t('auth.login.email')}
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

        <View className="mb-2">
          <Text className="text-sm font-medium text-gray-700 mb-2">
            {t('auth.login.password')}
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

        <Link href="/(auth)/forgot-password" className="self-end mb-6">
          <Text className="text-sm text-blue-600">{t('auth.login.forgotPassword')}</Text>
        </Link>

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
            {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Text>
        </Pressable>

        <View className="flex-row justify-center mt-6">
          <Text className="text-gray-600">{t('auth.login.noAccount')} </Text>
          <Link href="/(auth)/register">
            <Text className="text-blue-600 font-semibold">
              {t('auth.login.goToRegister')}
            </Text>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
