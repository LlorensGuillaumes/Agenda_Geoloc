import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  useAcceptFriendRequest,
  useFriends,
  useFriendRequests,
  useRejectFriendRequest,
  useRemoveFriend,
  useSearchFriend,
  useSendFriendRequest,
  useSetTrustLevel,
} from '@/lib/friends/hooks';
import { ApiError, type PublicUser } from '@/lib/api/client';
import { useToast } from '@/lib/ui/toast';

function Avatar({ user, size = 40 }: { user: { name: string }; size?: number }) {
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={{ width: size, height: size }}
      className="rounded-full bg-blue-100 items-center justify-center"
    >
      <Text className="text-blue-700 font-semibold">{initials}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 mt-6 mb-2">
      {children}
    </Text>
  );
}

function AddFriend() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<PublicUser | null>(null);
  const search = useSearchFriend();
  const send = useSendFriendRequest();

  const handleSearch = async () => {
    const q = email.trim().toLowerCase();
    if (!q) return;
    try {
      const user = await search.mutateAsync(q);
      setFound(user);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          Alert.alert(t('common.error'), t('friends.userNotFound'));
        } else if (err.status === 400) {
          Alert.alert(t('common.error'), t('friends.cannotAddSelf'));
        } else {
          Alert.alert(t('common.error'), t('friends.searchError'));
        }
      } else {
        Alert.alert(t('common.error'), t('friends.searchError'));
      }
    }
  };

  const handleSend = async () => {
    if (!found) return;
    try {
      await send.mutateAsync(found.id);
      showToast(t('friends.requestSent'), 'success');
      setFound(null);
      setEmail('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert(t('common.error'), t('friends.alreadyExists'));
        setFound(null);
        setEmail('');
      } else if (err instanceof ApiError) {
        const payload = err.payload as { error?: string } | null;
        Alert.alert(
          t('common.error'),
          `${t('friends.sendError')}\nHTTP ${err.status}${
            payload?.error ? ` · ${payload.error}` : ''
          }`,
        );
      } else {
        Alert.alert(
          t('common.error'),
          `${t('friends.sendError')}\n${
            err instanceof Error ? err.message : 'Unknown'
          }`,
        );
      }
    }
  };

  return (
    <View className="bg-white rounded-lg border border-gray-200 p-4">
      <Text className="text-sm font-semibold text-gray-700 mb-2">
        {t('friends.addByEmail')}
      </Text>
      <View className="flex-row items-center">
        <TextInput
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setFound(null);
          }}
          placeholder={t('friends.emailPlaceholder')}
          autoCapitalize="none"
          keyboardType="email-address"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 mr-2 text-gray-900"
        />
        <Pressable
          onPress={handleSearch}
          disabled={search.isPending}
          className="bg-blue-600 rounded-lg px-3 py-2 active:bg-blue-700"
        >
          {search.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="search" size={20} color="#fff" />
          )}
        </Pressable>
      </View>

      {found ? (
        <View className="mt-3 flex-row items-center bg-blue-50 rounded-lg p-3">
          <Avatar user={found} />
          <View className="flex-1 mx-3">
            <Text className="text-sm font-semibold text-gray-900">{found.name}</Text>
            <Text className="text-xs text-gray-500">{found.email}</Text>
          </View>
          <Pressable
            onPress={handleSend}
            disabled={send.isPending}
            className="bg-blue-600 rounded-lg px-3 py-2 active:bg-blue-700"
          >
            {send.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-sm font-medium">
                {t('friends.sendRequest')}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function FriendsScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const friends = useFriends();
  const requests = useFriendRequests();
  const accept = useAcceptFriendRequest();
  const reject = useRejectFriendRequest();
  const remove = useRemoveFriend();
  const setTrust = useSetTrustLevel();

  const handleAccept = async (id: string, name: string) => {
    try {
      await accept.mutateAsync(id);
      showToast(t('friends.acceptedToast', { name }), 'success');
    } catch {
      showToast(t('friends.acceptError'), 'error');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await reject.mutateAsync(id);
      showToast(t('friends.rejectedToast'), 'info');
    } catch {
      showToast(t('friends.rejectError'), 'error');
    }
  };

  const incoming = (requests.data ?? []).filter((r) => r.direction === 'incoming');
  const outgoing = (requests.data ?? []).filter((r) => r.direction === 'outgoing');
  const accepted = friends.data ?? [];

  const handleRemove = (friendshipId: string, name: string) => {
    Alert.alert(
      t('friends.removeConfirmTitle'),
      t('friends.removeConfirmBody', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await remove.mutateAsync(friendshipId);
              showToast(t('friends.removedToast', { name }), 'info');
            } catch {
              showToast(t('friends.removeError'), 'error');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['bottom']}>
      <Stack.Screen options={{ title: t('friends.title') }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={friends.isRefetching || requests.isRefetching}
              onRefresh={() => {
                friends.refetch();
                requests.refetch();
              }}
            />
          }
        >
          <AddFriend />

          {incoming.length > 0 && (
            <>
              <SectionTitle>{t('friends.incoming')}</SectionTitle>
              {incoming.map((r) => (
                <View
                  key={r.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 mb-2 flex-row items-center"
                >
                  <Avatar user={r.requester} />
                  <View className="flex-1 mx-3">
                    <Text className="text-sm font-semibold text-gray-900">
                      {r.requester.name}
                    </Text>
                    <Text className="text-xs text-gray-500">{r.requester.email}</Text>
                  </View>
                  <Pressable
                    onPress={() => handleAccept(r.id, r.requester.name)}
                    className="bg-green-600 rounded-lg px-3 py-2 mr-2 active:bg-green-700"
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => handleReject(r.id)}
                    className="bg-gray-300 rounded-lg px-3 py-2 active:bg-gray-400"
                  >
                    <Ionicons name="close" size={18} color="#374151" />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {outgoing.length > 0 && (
            <>
              <SectionTitle>{t('friends.outgoing')}</SectionTitle>
              {outgoing.map((r) => (
                <View
                  key={r.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 mb-2 flex-row items-center"
                >
                  {r.addressee ? <Avatar user={r.addressee} /> : <Avatar user={{ name: '?' }} />}
                  <View className="flex-1 mx-3">
                    <Text className="text-sm font-semibold text-gray-900">
                      {r.addressee?.name ?? '—'}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {r.addressee?.email ?? ''}
                    </Text>
                  </View>
                  <Text className="text-xs text-gray-400 italic mr-2">
                    {t('friends.pending')}
                  </Text>
                  <Pressable
                    onPress={() => handleReject(r.id)}
                    className="bg-gray-200 rounded-lg px-2 py-1 active:bg-gray-300"
                  >
                    <Text className="text-xs text-gray-700">{t('common.cancel')}</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <SectionTitle>{t('friends.acceptedSection')}</SectionTitle>
          {friends.isLoading ? (
            <View className="py-6 items-center">
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : accepted.length === 0 ? (
            <View className="bg-white border border-gray-200 rounded-lg p-6 items-center">
              <Ionicons name="people-outline" size={32} color="#9CA3AF" />
              <Text className="text-gray-500 text-sm mt-2 text-center">
                {t('friends.emptyAccepted')}
              </Text>
            </View>
          ) : (
            accepted.map((f) => (
              <View
                key={f.id}
                className="bg-white border border-gray-200 rounded-lg p-3 mb-2"
              >
                <View className="flex-row items-center">
                  {f.friend ? <Avatar user={f.friend} /> : <Avatar user={{ name: '?' }} />}
                  <View className="flex-1 mx-3">
                    <Text className="text-sm font-semibold text-gray-900">
                      {f.friend?.name ?? '—'}
                    </Text>
                    <Text className="text-xs text-gray-500">{f.friend?.email ?? ''}</Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemove(f.id, f.friend?.name ?? '—')}
                    className="p-2"
                  >
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </Pressable>
                </View>
                <Pressable
                  onPress={() =>
                    setTrust.mutate({
                      friendshipId: f.id,
                      trustLevel:
                        f.trustLevel === 'auto_accept' ? 'manual_accept' : 'auto_accept',
                    })
                  }
                  className="mt-3 flex-row items-center justify-between"
                >
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-medium text-gray-700">
                      {t('friends.autoAcceptLabel')}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {t('friends.autoAcceptHint')}
                    </Text>
                  </View>
                  <View
                    className={`w-12 h-7 rounded-full justify-center px-1 ${
                      f.trustLevel === 'auto_accept' ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <View
                      className={`w-5 h-5 bg-white rounded-full ${
                        f.trustLevel === 'auto_accept' ? 'self-end' : 'self-start'
                      }`}
                    />
                  </View>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
