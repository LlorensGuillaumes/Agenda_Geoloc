const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
    message?: string,
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, token, headers, ...rest } = options;
  const finalHeaders = new Headers(headers as HeadersInit | undefined);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, payload, extractMessage(payload, res.status));
  }
  return payload as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
  }
  return `Request failed (${status})`;
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  pushToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
};

type SignUpResponse = { token: string; user: AuthUser };
type SignInResponse = { token: string; user: AuthUser; redirect: boolean };
type MeResponse = { user: AuthUser; session: AuthSession };

export const api = {
  baseUrl: API_URL,

  signUp: (input: { email: string; password: string; name: string }) =>
    request<SignUpResponse>('/api/auth/sign-up/email', {
      method: 'POST',
      body: input,
    }),

  signIn: (input: { email: string; password: string }) =>
    request<SignInResponse>('/api/auth/sign-in/email', {
      method: 'POST',
      body: input,
    }),

  signOut: (token: string) =>
    request<{ success: boolean }>('/api/auth/sign-out', {
      method: 'POST',
      token,
      body: {},
    }),

  me: (token: string) => request<MeResponse>('/api/me', { token }),
};
