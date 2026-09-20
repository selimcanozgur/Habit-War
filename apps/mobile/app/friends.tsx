/**
 * The friends screen.
 *
 * Design premise: the user arriving here almost certainly has zero friends. A
 * social product's friends tab is normally built for someone who already has a
 * graph, which leaves the first user staring at an empty list with no idea what to
 * do. So the order is inverted — the search box sits at the top, always, and the
 * empty list is a set of instructions rather than a shrug.
 *
 * Search is debounced because the endpoint is hit on every keystroke otherwise,
 * and the in-flight request is aborted when the query moves on, so a slow response
 * for "a" cannot land after the response for "ahm".
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import {
  acceptFriendRequest,
  declineFriendRequest,
  listFriendRequests,
  listFriends,
  normaliseFriends,
  normaliseRequests,
  normaliseUser,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  type SocialUser,
} from '../src/api/social';
import { UserRow } from '../src/components/UserRow';
import { colors, radius, spacing, type } from '../src/theme';

/** Long enough that a normal typist fires one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 350;
/** Single letters match almost everyone; two is where a result set becomes useful. */
const MIN_QUERY_LENGTH = 2;

export default function FriendsScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Debounce: the committed query trails the typed one.
  useEffect(() => {
    const trimmed = query.trim();
    const id = setTimeout(() => setDebouncedQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const friendsQuery = useQuery({ queryKey: ['friends'], queryFn: listFriends });
  const requestsQuery = useQuery({ queryKey: ['friendRequests'], queryFn: listFriendRequests });

  const searchQuery = useQuery({
    queryKey: ['userSearch', debouncedQuery],
    queryFn: ({ signal }) => searchUsers(debouncedQuery, signal),
    enabled: debouncedQuery.length >= MIN_QUERY_LENGTH,
  });

  const friends = useMemo(
    () => normaliseFriends(friendsQuery.data?.friends),
    [friendsQuery.data],
  );
  const incoming = useMemo(
    () => normaliseRequests(requestsQuery.data?.incoming),
    [requestsQuery.data],
  );
  const outgoing = useMemo(
    () => normaliseRequests(requestsQuery.data?.outgoing),
    [requestsQuery.data],
  );

  /**
   * Usernames already spoken for.
   *
   * Search results are filtered against them so the user is never offered an "Ekle"
   * button that can only fail — the backend would reject a duplicate request anyway,
   * and a rejected tap reads as a bug.
   */
  const knownUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const friend of friends) set.add(friend.user.username);
    for (const request of incoming) set.add(request.user.username);
    for (const request of outgoing) set.add(request.user.username);
    return set;
  }, [friends, incoming, outgoing]);

  const searchResults = useMemo<SocialUser[]>(() => {
    const users = searchQuery.data?.users;
    if (!Array.isArray(users)) return [];
    return users.map((user, index) => normaliseUser(user, index));
  }, [searchQuery.data]);

  function refreshSocial(): void {
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
    void queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
    void queryClient.invalidateQueries({ queryKey: ['friendsLeaderboard'] });
  }

  const addMutation = useMutation({
    mutationFn: (username: string) => sendFriendRequest(username),
    onSuccess: (_data, username) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(`${username} kullanıcısına istek gönderildi.`);
      refreshSocial();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const acceptMutation = useMutation({
    mutationFn: (friendshipId: string) => acceptFriendRequest(friendshipId),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice('Arkadaşlık kuruldu.');
      refreshSocial();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const declineMutation = useMutation({
    mutationFn: (friendshipId: string) => declineFriendRequest(friendshipId),
    onSuccess: () => {
      setNotice('İstek reddedildi.');
      refreshSocial();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (friendshipId: string) => removeFriend(friendshipId),
    onSuccess: () => {
      setNotice('İstek iptal edildi.');
      refreshSocial();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const busy =
    addMutation.isPending ||
    acceptMutation.isPending ||
    declineMutation.isPending ||
    removeMutation.isPending;

  const isSearching = debouncedQuery.length >= MIN_QUERY_LENGTH;
  const listsPending = friendsQuery.isPending || requestsQuery.isPending;
  const listsFailed = friendsQuery.isError && requestsQuery.isError;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Arkadaşlar</Text>

        {/* Search leads the screen rather than hiding behind a "+" button: for a
            user with no friends, this input *is* the screen. */}
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Kullanıcı adı ara"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Kullanıcı ara"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
              hitSlop={spacing.sm}
            >
              <Text style={styles.clearIcon}>✕</Text>
            </Pressable>
          )}
        </View>

        {notice !== null && (
          <Pressable
            onPress={() => setNotice(null)}
            accessibilityRole="button"
            accessibilityLabel="Bildirimi kapat"
          >
            <Text style={styles.notice}>{notice}</Text>
          </Pressable>
        )}

        {isSearching ? (
          <Section title="Arama sonuçları">
            {searchQuery.isPending ? (
              <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
            ) : searchQuery.isError ? (
              <ErrorBlock
                message={describeError(searchQuery.error)}
                onRetry={() => void searchQuery.refetch()}
              />
            ) : searchResults.length === 0 ? (
              <Text style={styles.empty}>
                “{debouncedQuery}” ile eşleşen kullanıcı yok. Kullanıcı adını tam yazmayı dene.
              </Text>
            ) : (
              searchResults.map((user) => {
                const alreadyKnown = knownUsernames.has(user.username);
                return (
                  <UserRow
                    key={user.id}
                    user={user}
                    trailing={
                      alreadyKnown ? (
                        <Text style={styles.trailingLabel}>Ekli</Text>
                      ) : (
                        <Pressable
                          style={[styles.smallButton, busy && styles.buttonDisabled]}
                          disabled={busy}
                          onPress={() => addMutation.mutate(user.username)}
                          accessibilityRole="button"
                          accessibilityLabel={`${user.displayName} kullanıcısına arkadaşlık isteği gönder`}
                        >
                          <Text style={styles.smallButtonText}>Ekle</Text>
                        </Pressable>
                      )
                    }
                  />
                );
              })
            )}
          </Section>
        ) : (
          <>
            {query.trim().length > 0 && (
              <Text style={styles.hint}>Aramak için en az {MIN_QUERY_LENGTH} harf yaz.</Text>
            )}

            {listsPending ? (
              <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
            ) : listsFailed ? (
              <ErrorBlock
                message={describeError(friendsQuery.error)}
                onRetry={() => {
                  void friendsQuery.refetch();
                  void requestsQuery.refetch();
                }}
              />
            ) : (
              <>
                {incoming.length > 0 && (
                  <Section title={`Gelen istekler (${incoming.length})`}>
                    {incoming.map((request) => (
                      <UserRow
                        key={request.friendshipId}
                        user={request.user}
                        trailing={
                          <>
                            <Pressable
                              style={[styles.smallButton, busy && styles.buttonDisabled]}
                              disabled={busy}
                              onPress={() => acceptMutation.mutate(request.friendshipId)}
                              accessibilityRole="button"
                              accessibilityLabel={`${request.user.displayName} isteğini kabul et`}
                            >
                              <Text style={styles.smallButtonText}>Kabul</Text>
                            </Pressable>
                            <Pressable
                              style={[styles.ghostSmallButton, busy && styles.buttonDisabled]}
                              disabled={busy}
                              onPress={() => declineMutation.mutate(request.friendshipId)}
                              accessibilityRole="button"
                              accessibilityLabel={`${request.user.displayName} isteğini reddet`}
                            >
                              <Text style={styles.ghostSmallButtonText}>Reddet</Text>
                            </Pressable>
                          </>
                        }
                      />
                    ))}
                  </Section>
                )}

                {outgoing.length > 0 && (
                  <Section title="Gönderilen istekler">
                    {outgoing.map((request) => (
                      <UserRow
                        key={request.friendshipId}
                        user={request.user}
                        subtitle="Yanıt bekleniyor"
                        trailing={
                          <Pressable
                            style={[styles.ghostSmallButton, busy && styles.buttonDisabled]}
                            disabled={busy}
                            onPress={() => removeMutation.mutate(request.friendshipId)}
                            accessibilityRole="button"
                            accessibilityLabel={`${request.user.displayName} isteğini iptal et`}
                          >
                            <Text style={styles.ghostSmallButtonText}>İptal</Text>
                          </Pressable>
                        }
                      />
                    ))}
                  </Section>
                )}

                <Section title={friends.length > 0 ? `Arkadaşların (${friends.length})` : 'Arkadaşların'}>
                  {friends.length === 0 ? (
                    <ColdStart hasOutgoing={outgoing.length > 0} />
                  ) : (
                    friends.map((friend) => (
                      <UserRow
                        key={friend.friendshipId}
                        user={friend.user}
                        subtitle={
                          friend.currentStreak > 0
                            ? `${friend.currentStreak} günlük seri`
                            : 'Seri yok'
                        }
                      />
                    ))
                  )}
                </Section>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The empty state.
 *
 * Written as instructions, not as a status. Someone who reads this should know
 * exactly what their next tap is, and why it is worth making — the "why" matters
 * because adding a friend costs social effort and the payoff (a leaderboard, a
 * duel) is not visible from an empty screen.
 */
function ColdStart({ hasOutgoing }: { readonly hasOutgoing: boolean }): React.JSX.Element {
  return (
    <View style={styles.coldStart}>
      <Text style={styles.coldStartTitle}>
        {hasOutgoing ? 'Henüz kabul eden olmadı' : 'Burası şimdilik boş'}
      </Text>
      <Text style={styles.coldStartBody}>
        {hasOutgoing
          ? 'Gönderdiğin istekler yanıt bekliyor. Bu arada başka birini daha arayabilirsin.'
          : 'Arkadaş eklemek için yukarıdaki arama kutusuna bir kullanıcı adı yaz ve “Ekle” de. ' +
            'İstek kabul edilince o kişi buraya düşer.'}
      </Text>
      <View style={styles.coldStartList}>
        <Text style={styles.coldStartItem}>
          • Haftalık XP sıralamasında arkadaşlarınla yarışırsın.
        </Text>
        <Text style={styles.coldStartItem}>
          • Bir arkadaşını 3–7 günlük düelloya çağırabilirsin.
        </Text>
        <Text style={styles.coldStartItem}>• Serileri ve seviyeleri buradan takip edersin.</Text>
      </View>
      <Text style={styles.coldStartFooter}>
        Kullanıcı adını bilmiyorsan, arkadaşından profilindeki adı istemen yeterli.
      </Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.errorBlock}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        style={styles.secondaryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Tekrar dene"
      >
        <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
      </Pressable>
    </View>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { ...type.title, color: colors.text },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { ...type.body, color: colors.text, flex: 1, paddingVertical: spacing.md },
  clearIcon: { ...type.label, color: colors.textFaint },

  hint: { ...type.caption, color: colors.textFaint },
  notice: {
    ...type.caption,
    color: colors.accentBright,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },

  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionBody: { gap: spacing.sm },

  inlineLoader: { marginTop: spacing.xl },
  empty: { ...type.body, color: colors.textFaint, paddingVertical: spacing.md },

  coldStart: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  coldStartTitle: { ...type.heading, color: colors.text },
  coldStartBody: { ...type.body, color: colors.textMuted },
  coldStartList: { gap: spacing.xs, marginTop: spacing.xs },
  coldStartItem: { ...type.body, color: colors.textMuted },
  coldStartFooter: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },

  smallButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  smallButtonText: { ...type.label, color: '#FFFFFF' },
  ghostSmallButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  ghostSmallButtonText: { ...type.label, color: colors.textMuted },
  trailingLabel: { ...type.caption, color: colors.textFaint },
  buttonDisabled: { opacity: 0.5 },

  errorBlock: { gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.md },
  errorText: { ...type.body, color: colors.danger },
  secondaryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  secondaryButtonText: { ...type.label, color: colors.text },
});
