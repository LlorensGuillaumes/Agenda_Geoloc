/**
 * Envío de push notifications vía Expo Push API.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Estrategia:
 * - Fire-and-forget: nunca bloquea la respuesta del endpoint que dispara
 *   el push. Si falla, lo logueamos y seguimos.
 * - Si EXPO_ACCESS_TOKEN está definido lo enviamos (recomendado para
 *   "Enhanced Push Security"). Si no, se envía sin auth — Expo lo acepta
 *   pero es más laxo con rate limits y suplantación.
 * - Solo acepta tokens ExponentPushToken[xxxxx]. Si llega otro formato
 *   (raro: device token nativo), saltamos sin error.
 */
import { env } from './env.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushMessage = {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  channelId?: string;
};

function isExpoPushToken(token: string | null | undefined): token is string {
  return !!token && /^ExponentPushToken\[.+\]$/.test(token);
}

/**
 * Envía un push. Resuelve siempre sin lanzar excepción — los errores se
 * loguean. Diseñado para llamarse sin await desde un handler.
 */
export async function sendPush(message: PushMessage): Promise<void> {
  if (!isExpoPushToken(message.to)) {
    // Token inválido o ausente — silencio. La columna pushToken puede estar
    // a null si el user todavía no abrió la app tras instalar.
    return;
  }

  const payload = {
    to: message.to,
    title: message.title,
    body: message.body ?? '',
    data: message.data ?? {},
    sound: message.sound === null ? null : 'default',
    channelId: message.channelId ?? 'alarms',
    priority: 'high' as const,
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
    }
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[push] expo push failed status=${res.status}`, text);
      return;
    }
    // Inspeccionamos la respuesta solo para detectar tokens caducados/inválidos
    // sin reaccionar: la lógica de invalidación queda para un futuro slice.
    const json = (await res.json().catch(() => null)) as
      | { data?: { status?: string; details?: { error?: string } } }
      | null;
    if (json?.data?.status === 'error') {
      console.warn('[push] expo ticket error', json.data.details?.error);
    }
  } catch (err) {
    console.warn('[push] expo push network error', err);
  }
}

/**
 * Envío en paralelo a varios tokens. Igual de tolerante a fallos.
 */
export async function sendPushMany(messages: PushMessage[]): Promise<void> {
  await Promise.allSettled(messages.map((m) => sendPush(m)));
}
