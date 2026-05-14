import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CreatePlaceInput,
  type Place,
  type PlaceShare,
  type SharedPlace,
} from '../api/client';
import { useAuthStore } from '../auth/store';

const PLACES_KEY = ['places'] as const;
const SHARED_WITH_ME_KEY = ['places', 'shared-with-me'] as const;
const placeSharesKey = (placeId: string) => ['places', placeId, 'shares'] as const;

export function usePlaces() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: PLACES_KEY,
    queryFn: () => api.places.list(token!),
    enabled: !!token,
  });
}

export function useCreatePlace() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePlaceInput) => api.places.create(token!, data),
    onSuccess: (newPlace) => {
      qc.setQueryData<Place[]>(PLACES_KEY, (prev) => [...(prev ?? []), newPlace]);
    },
  });
}

export function useUpdatePlace() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; data: Partial<CreatePlaceInput> }) =>
      api.places.update(token!, input.id, input.data),
    onSuccess: (updated) => {
      qc.setQueryData<Place[]>(PLACES_KEY, (prev) =>
        (prev ?? []).map((p) => (p.id === updated.id ? updated : p)),
      );
    },
  });
}

export function useDeletePlace() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.places.remove(token!, id),
    onSuccess: (_, id) => {
      qc.setQueryData<Place[]>(PLACES_KEY, (prev) =>
        (prev ?? []).filter((p) => p.id !== id),
      );
    },
  });
}

export function useSharedWithMePlaces() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: SHARED_WITH_ME_KEY,
    queryFn: () => api.placeShares.sharedWithMe(token!),
    enabled: !!token,
  });
}

export function usePlaceShares(placeId: string | undefined) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: placeId ? placeSharesKey(placeId) : ['places', '_', 'shares'],
    queryFn: () => api.placeShares.list(token!, placeId!),
    enabled: !!token && !!placeId,
  });
}

export function useSharePlace(placeId: string) {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.placeShares.create(token!, placeId, userId),
    onSuccess: (newShare) => {
      qc.setQueryData<PlaceShare[]>(placeSharesKey(placeId), (prev) => {
        if (!prev) return [newShare];
        // Idempotent: si ya existía el share, lo reemplazamos en vez de duplicar.
        const filtered = prev.filter((s) => s.sharedWith.id !== newShare.sharedWith.id);
        return [...filtered, newShare];
      });
    },
  });
}

export function useUnsharePlace(placeId: string) {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.placeShares.remove(token!, placeId, userId),
    onSuccess: (_, userId) => {
      qc.setQueryData<PlaceShare[]>(placeSharesKey(placeId), (prev) =>
        (prev ?? []).filter((s) => s.sharedWith.id !== userId),
      );
      // Si la otra parte mira shared-with-me, esa query se actualizará en el
      // siguiente refetch. No la tocamos aquí porque vive en otro usuario.
    },
  });
}

// `SharedPlace` reexportado por conveniencia para callers que quieran tipar.
export type { SharedPlace };
