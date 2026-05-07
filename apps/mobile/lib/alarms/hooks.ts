import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Alarm, type CreateAlarmInput } from '../api/client';
import { useAuthStore } from '../auth/store';

const ALARMS_KEY = ['alarms'] as const;

export function useAlarms() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ALARMS_KEY,
    queryFn: () => api.alarms.list(token!),
    enabled: !!token,
  });
}

export function useCreateAlarm() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAlarmInput) => api.alarms.create(token!, data),
    onSuccess: (newAlarm) => {
      qc.setQueryData<Alarm[]>(ALARMS_KEY, (prev) => [newAlarm, ...(prev ?? [])]);
    },
  });
}

export function useUpdateAlarm() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      data: Parameters<typeof api.alarms.update>[2];
    }) => api.alarms.update(token!, input.id, input.data),
    onSuccess: (updated) => {
      qc.setQueryData<Alarm[]>(ALARMS_KEY, (prev) =>
        (prev ?? []).map((a) => (a.id === updated.id ? updated : a)),
      );
    },
  });
}

export function useDeleteAlarm() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.alarms.remove(token!, id),
    onSuccess: (_, id) => {
      qc.setQueryData<Alarm[]>(ALARMS_KEY, (prev) =>
        (prev ?? []).filter((a) => a.id !== id),
      );
    },
  });
}
