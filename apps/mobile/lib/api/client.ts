const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// React Native fetch no envía Origin (los browsers sí). Better-Auth aplica un
// check anti-CSRF que rechaza POST sin Origin. Mandamos uno que esté en la
// lista de trustedOrigins del backend.
const CLIENT_ORIGIN = 'http://localhost:8081';

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
  finalHeaders.set('Origin', CLIENT_ORIGIN);
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

export type Place = {
  id: string;
  ownerId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  icon: string | null;
  color: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeConfig = {
  datetime?: string;
  repeat: 'once' | 'daily' | 'weekly';
  weekdays?: number[];
  timeWindow?: { start: string; end: string };
};

export type ActiveWindow = {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  weekdays?: number[]; // 0=domingo, 6=sábado
};

export type LocationConfig = {
  mode: 'saved_place' | 'custom_point';
  placeId?: string;
  customPoint?: { latitude: number; longitude: number; radiusMeters: number };
  event: 'enter' | 'exit' | 'nearby';
  repeat?: 'once' | 'always';
  activeWindow?: ActiveWindow;
};

export type NotifyAction = 'call' | 'whatsapp';

export type NotifyConfig = {
  contactName?: string;
  contactPhone?: string;
  actions: NotifyAction[];
  whatsappMessage?: string;
};

export type Alarm = {
  id: string;
  ownerId: string;
  creatorId: string;
  title: string;
  notes: string | null;
  isActive: boolean;
  triggerType: 'time' | 'location' | 'time_and_location';
  timeConfig: TimeConfig | null;
  locationConfig: LocationConfig | null;
  notifyConfig: NotifyConfig | null;
  status: 'pending_acceptance' | 'active' | 'paused' | 'completed';
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
};

export type CreatePlaceInput = {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  icon?: string;
  color?: string;
  address?: string;
};

export type CreateAlarmInput = {
  title: string;
  notes?: string;
  triggerType: Alarm['triggerType'];
  timeConfig?: TimeConfig;
  locationConfig?: LocationConfig;
  notifyConfig?: NotifyConfig;
  ownerId?: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type TrustLevel = 'manual_accept' | 'auto_accept';

export type Friendship = {
  id: string;
  status: 'accepted';
  trustLevel: TrustLevel;
  createdAt: string;
  acceptedAt: string | null;
  friend: PublicUser | null;
};

export type FriendRequest = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending';
  trustLevel: TrustLevel;
  createdAt: string;
  // Solo uno de los dos lados está poblado: `requester` cuando es
  // incoming (alguien me la ha enviado), `addressee` cuando es outgoing
  // (yo se la he enviado). El otro siempre es null.
  requester: PublicUser | null;
  addressee: PublicUser | null;
  direction: 'incoming' | 'outgoing';
};

export type PlaceShare = {
  id: string;
  createdAt: string;
  sharedWith: PublicUser;
};

export type SharedPlace = Place & { owner: PublicUser | null };

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

  places: {
    list: (token: string) => request<Place[]>('/api/places', { token }),
    create: (token: string, data: CreatePlaceInput) =>
      request<Place>('/api/places', { method: 'POST', token, body: data }),
    update: (token: string, id: string, data: Partial<CreatePlaceInput>) =>
      request<Place>(`/api/places/${id}`, { method: 'PATCH', token, body: data }),
    remove: (token: string, id: string) =>
      request<null>(`/api/places/${id}`, { method: 'DELETE', token }),
  },

  alarms: {
    list: (token: string) => request<Alarm[]>('/api/alarms', { token }),
    create: (token: string, data: CreateAlarmInput) =>
      request<Alarm>('/api/alarms', { method: 'POST', token, body: data }),
    update: (
      token: string,
      id: string,
      data: Partial<{
        title: string;
        notes: string;
        isActive: boolean;
        timeConfig: TimeConfig;
        locationConfig: LocationConfig;
        notifyConfig: NotifyConfig | null;
      }>,
    ) => request<Alarm>(`/api/alarms/${id}`, { method: 'PATCH', token, body: data }),
    remove: (token: string, id: string) =>
      request<null>(`/api/alarms/${id}`, { method: 'DELETE', token }),
    accept: (token: string, id: string) =>
      request<Alarm>(`/api/alarms/${id}/accept`, { method: 'POST', token, body: {} }),
    reject: (token: string, id: string) =>
      request<null>(`/api/alarms/${id}/reject`, { method: 'POST', token, body: {} }),
  },

  friends: {
    list: (token: string) => request<Friendship[]>('/api/friends', { token }),
    requests: (token: string) =>
      request<FriendRequest[]>('/api/friends/requests', { token }),
    search: (token: string, email: string) =>
      request<PublicUser>('/api/friends/search', {
        method: 'POST',
        token,
        body: { email },
      }),
    sendRequest: (token: string, addresseeId: string) =>
      request<FriendRequest>('/api/friends/requests', {
        method: 'POST',
        token,
        body: { addresseeId },
      }),
    accept: (token: string, friendshipId: string) =>
      request<Friendship>(`/api/friends/requests/${friendshipId}/accept`, {
        method: 'POST',
        token,
        body: {},
      }),
    // Sirve tanto para rechazar una pendiente como para cancelar la mía outgoing.
    rejectRequest: (token: string, friendshipId: string) =>
      request<null>(`/api/friends/requests/${friendshipId}`, {
        method: 'DELETE',
        token,
      }),
    remove: (token: string, friendshipId: string) =>
      request<null>(`/api/friends/${friendshipId}`, { method: 'DELETE', token }),
    setTrustLevel: (token: string, friendshipId: string, trustLevel: TrustLevel) =>
      request<Friendship>(`/api/friends/${friendshipId}`, {
        method: 'PATCH',
        token,
        body: { trustLevel },
      }),
  },

  placeShares: {
    sharedWithMe: (token: string) =>
      request<SharedPlace[]>('/api/places/shared-with-me', { token }),
    list: (token: string, placeId: string) =>
      request<PlaceShare[]>(`/api/places/${placeId}/shares`, { token }),
    create: (token: string, placeId: string, userId: string) =>
      request<PlaceShare>(`/api/places/${placeId}/shares`, {
        method: 'POST',
        token,
        body: { userId },
      }),
    remove: (token: string, placeId: string, userId: string) =>
      request<null>(`/api/places/${placeId}/shares/${userId}`, {
        method: 'DELETE',
        token,
      }),
  },

  traces: {
    send: (token: string, traces: TraceItem[]) =>
      request<null>('/api/traces', {
        method: 'POST',
        token,
        body: { traces },
      }),
  },
};

export type TraceItem = {
  ts: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  alarmId?: string | null;
  alarmTitle?: string | null;
  alarmEvent?: 'enter' | 'exit' | 'nearby' | null;
  alarmRepeat?: 'once' | 'always' | null;
  outerRadius?: number | null;
  distance?: number | null;
  insideOuter?: boolean | null;
  lastDistance?: number | null;
  outsideStreak?: number | null;
  didFire: boolean;
  source?: string | null;
  note?: string | null;
};
