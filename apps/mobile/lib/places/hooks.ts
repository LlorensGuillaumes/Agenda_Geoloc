import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreatePlaceInput, type Place } from '../api/client';
import { useAuthStore } from '../auth/store';

const PLACES_KEY = ['places'] as const;

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
