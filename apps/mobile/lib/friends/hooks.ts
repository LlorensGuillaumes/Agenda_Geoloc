import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type FriendRequest,
  type Friendship,
  type TrustLevel,
} from '../api/client';
import { useAuthStore } from '../auth/store';

const FRIENDS_KEY = ['friends'] as const;
const REQUESTS_KEY = ['friends', 'requests'] as const;

export function useFriends() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: FRIENDS_KEY,
    queryFn: () => api.friends.list(token!),
    enabled: !!token,
  });
}

export function useFriendRequests() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: () => api.friends.requests(token!),
    enabled: !!token,
  });
}

export function useSearchFriend() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: (email: string) => api.friends.search(token!, email),
  });
}

export function useSendFriendRequest() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (addresseeId: string) => api.friends.sendRequest(token!, addresseeId),
    onSuccess: (req) => {
      qc.setQueryData<FriendRequest[]>(REQUESTS_KEY, (prev) => [...(prev ?? []), req]);
    },
  });
}

export function useAcceptFriendRequest() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => api.friends.accept(token!, friendshipId),
    onSuccess: (friendship, friendshipId) => {
      qc.setQueryData<FriendRequest[]>(REQUESTS_KEY, (prev) =>
        (prev ?? []).filter((r) => r.id !== friendshipId),
      );
      qc.setQueryData<Friendship[]>(FRIENDS_KEY, (prev) => [...(prev ?? []), friendship]);
    },
  });
}

export function useRejectFriendRequest() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) =>
      api.friends.rejectRequest(token!, friendshipId),
    onSuccess: (_, friendshipId) => {
      qc.setQueryData<FriendRequest[]>(REQUESTS_KEY, (prev) =>
        (prev ?? []).filter((r) => r.id !== friendshipId),
      );
    },
  });
}

export function useRemoveFriend() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (friendshipId: string) => api.friends.remove(token!, friendshipId),
    onSuccess: (_, friendshipId) => {
      qc.setQueryData<Friendship[]>(FRIENDS_KEY, (prev) =>
        (prev ?? []).filter((f) => f.id !== friendshipId),
      );
    },
  });
}

export function useSetTrustLevel() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { friendshipId: string; trustLevel: TrustLevel }) =>
      api.friends.setTrustLevel(token!, input.friendshipId, input.trustLevel),
    onSuccess: (updated) => {
      qc.setQueryData<Friendship[]>(FRIENDS_KEY, (prev) =>
        (prev ?? []).map((f) => (f.id === updated.id ? updated : f)),
      );
    },
  });
}
