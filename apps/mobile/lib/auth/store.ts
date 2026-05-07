import { create } from 'zustand';
import { api, ApiError, type AuthUser } from '../api/client';
import { tokenStorage } from './storage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  token: string | null;
  hydrate: () => Promise<void>;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: { email: string; password: string; name: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  token: null,

  hydrate: async () => {
    const token = await tokenStorage.get();
    if (!token) {
      set({ status: 'unauthenticated', user: null, token: null });
      return;
    }
    try {
      const { user } = await api.me(token);
      set({ status: 'authenticated', user, token });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await tokenStorage.clear();
      }
      set({ status: 'unauthenticated', user: null, token: null });
    }
  },

  signIn: async ({ email, password }) => {
    const { token, user } = await api.signIn({ email, password });
    await tokenStorage.set(token);
    set({ status: 'authenticated', user, token });
  },

  signUp: async ({ email, password, name }) => {
    const { token, user } = await api.signUp({ email, password, name });
    await tokenStorage.set(token);
    set({ status: 'authenticated', user, token });
  },

  signOut: async () => {
    const token = get().token;
    if (token) {
      try {
        await api.signOut(token);
      } catch {
        // Ignore: even si el backend falla, limpiamos local.
      }
    }
    await tokenStorage.clear();
    set({ status: 'unauthenticated', user: null, token: null });
  },
}));
