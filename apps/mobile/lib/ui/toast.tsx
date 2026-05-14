/**
 * Sistema de toasts mínimo: un Context expone `showToast(message, kind?)` y un
 * componente nivel-raíz renderiza el toast activo con fade-in/out. Sin
 * dependencias nativas — compatible con OTA updates.
 *
 * Uso:
 *   const { showToast } = useToast();
 *   showToast(t('alarms.acceptedToast'));         // info por defecto
 *   showToast(t('alarms.deleted'), 'success');
 *   showToast(t('common.errorGeneric'), 'error');
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export type ToastKind = 'info' | 'success' | 'error';

type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ToastContextValue = {
  showToast: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_TTL_MS = 2800;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback no-op para evitar crashes si alguien usa el hook fuera del
    // provider (no debería pasar; el provider se monta en el root layout).
    return { showToast: () => {} };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setToast(null));
  }, [opacity]);

  const showToast = useCallback<ToastContextValue['showToast']>(
    (message, kind = 'info') => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      const id = ++nextId.current;
      setToast({ id, message, kind });
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      dismissTimer.current = setTimeout(dismiss, DEFAULT_TTL_MS);
    },
    [dismiss, opacity],
  );

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <SafeAreaView
          pointerEvents="box-none"
          className="absolute left-0 right-0 bottom-0 items-center"
          edges={['bottom']}
        >
          <Animated.View
            style={{ opacity }}
            className="mb-4 mx-4"
            pointerEvents="auto"
          >
            <Pressable onPress={dismiss}>
              <View
                className={`flex-row items-center px-4 py-3 rounded-lg shadow-lg ${bgFor(
                  toast.kind,
                )}`}
              >
                <Ionicons
                  name={iconFor(toast.kind)}
                  size={20}
                  color="#fff"
                  style={{ marginRight: 10 }}
                />
                <Text
                  className="text-white text-sm font-medium flex-shrink"
                  numberOfLines={3}
                >
                  {toast.message}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        </SafeAreaView>
      ) : null}
    </ToastContext.Provider>
  );
}

function bgFor(kind: ToastKind): string {
  if (kind === 'success') return 'bg-green-600';
  if (kind === 'error') return 'bg-red-600';
  return 'bg-gray-900';
}

function iconFor(kind: ToastKind): keyof typeof Ionicons.glyphMap {
  if (kind === 'success') return 'checkmark-circle';
  if (kind === 'error') return 'alert-circle';
  return 'information-circle';
}
