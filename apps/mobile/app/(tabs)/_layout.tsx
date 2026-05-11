import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { HapticTab } from '@/components/haptic-tab';
import { useAuthStore } from '@/lib/auth/store';
import { useGeofenceSync } from '@/lib/geofencing/useSync';

export default function TabLayout() {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);

  // Mantiene los geofences nativos sincronizados con las alarmas del usuario.
  // No-op cuando status !== 'authenticated'.
  useGeofenceSync();

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#6B7280',
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.agenda'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="alarm-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="places"
        options={{
          title: t('tabs.places'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="location-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
