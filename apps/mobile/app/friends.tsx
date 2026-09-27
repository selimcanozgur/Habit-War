/**
 * The friends screen.
 *
 * Design premise: the user arriving here almost certainly has zero friends. A
 * social product's friends tab is normally built for someone who already has a
 * graph, which leaves the first user staring at an empty list with no idea what to
 * do. So the order is inverted — the search box sits at the top, always, and the
 * empty list is a set of instructions rather than a shrug.
 *
 * Because that box is the screen's real job, it is styled as the loudest object on
 * it: full width, a heavy outline, a magnifier inside it, and a border that turns
 * primary the moment there is anything to search for. Anything quieter and the cold
 * start fails silently.
 *
 * Search is debounced because the endpoint is hit on every keystroke otherwise,
 * and the in-flight request is aborted when the query moves on, so a slow response
 * for "a" cannot land after the response for "ahm".
 */

import { Ionicons } from '@expo/vector-icons';
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
import { Button, ChipButton, cardStyle } from '../src/components/Button';
import { UserRow } from '../src/components/UserRow';
import { colors, radius, spacing, type } from '../src/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Long enough that a normal typist fires one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 350;
/** Single letters match almost everyone; two is where a result set becomes useful. */
const MIN_QUERY_LENGTH = 2;

const ICON_SIZE = 20;
/** The magnifier and the clear control, sized to sit level with 16px input text. */
const SEARCH_ICON_SIZE = 22;

/**
 * The payoffs listed in the empty state, each with the icon of the screen it pays
 * off on — a leaderboard, a duel, a streak. Icons rather than bullet characters so
 * the three lines scan as three different rewards.
 */
const COLD_START_ITEMS: readonly { readonly icon: IoniconName; readonly text: string }[] = [
  { icon: 'podium', text: 'Haftalık XP sıralamasında arkadaşlarınla yarışırsın.' },
  { icon: 'flash', text: 'Bir arkadaşını 3–7 günlük düelloya çağırabilirsin.' },
  { icon: 'flame', text: 'Serileri ve seviyeleri buradan takip edersin.' },
];

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
        <View style={styles.titleRow}>
          <Ionicons name="person-add" size={26} color={colors.accent} />
          <Text style={styles.title}>Arkadaşlar</Text>
        </View>

        {/* Search leads the screen rather than hiding behind a "+" button: for a
            user with no friends, this input *is* the screen. */}
        <View style={[styles.searchBox, query.length > 0 && styles.searchBoxActive]}>
          <Ionicons
            name="search"
            size={SEARCH_ICON_SIZE}
            color={query.length > 0 ? colors.accent : colors.textMuted}
          />
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
              <Ionicons name="close-circle" size={SEARCH_ICON_SIZE} color={colors.textFaint} />
            </Pressable>
          )}
        </View>

        {notice !== null && <Notice message={notice} onDismiss={() => setNotice(null)} />}

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
                        <View style={styles.trailingLabelGroup}>
                          <Ionicons
                            name="checkmark-circle"
                            size={ICON_SIZE}
                            color={colors.success}
                          />
                          <Text style={styles.trailingLabel}>Ekli</Text>
                        </View>
                      ) : (
                        <ChipButton
                          label="Ekle"
                          tone="primary"
                          disabled={busy}
                          onPress={() => addMutation.mutate(user.username)}
                          accessibilityLabel={`${user.displayName} kullanıcısına arkadaşlık isteği gönder`}
                        />
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
                            {/* Accepting is the good outcome, so it takes the success
                                tone; declining stays neutral rather than red — this
                                is not a destructive action, just a "no". */}
                            <ChipButton
                              label="Kabul"
                              tone="success"
                              disabled={busy}
                              onPress={() => acceptMutation.mutate(request.friendshipId)}
                              accessibilityLabel={`${request.user.displayName} isteğini kabul et`}
                            />
                            <ChipButton
                              label="Reddet"
                              tone="neutral"
                              disabled={busy}
                              onPress={() => declineMutation.mutate(request.friendshipId)}
                              accessibilityLabel={`${request.user.displayName} isteğini reddet`}
                            />
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
                          <ChipButton
                            label="İptal"
                            tone="neutral"
                            disabled={busy}
                            onPress={() => removeMutation.mutate(request.friendshipId)}
                            accessibilityLabel={`${request.user.displayName} isteğini iptal et`}
                          />
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
        {COLD_START_ITEMS.map((item) => (
          <View key={item.icon} style={styles.coldStartItem}>
            <Ionicons name={item.icon} size={ICON_SIZE} color={colors.accent} />
            <Text style={styles.coldStartItemText}>{item.text}</Text>
          </View>
        ))}
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

/** Transient result of a mutation. Tappable to dismiss, as it always was. */
function Notice({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel="Bildirimi kapat"
      style={styles.notice}
    >
      <Ionicons name="information-circle" size={ICON_SIZE} color={colors.accent} />
      <Text style={styles.noticeText}>{message}</Text>
      <Ionicons name="close" size={ICON_SIZE} color={colors.textMuted} />
    </Pressable>
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
      <View style={styles.errorRow}>
        <Ionicons name="alert-circle" size={ICON_SIZE} color={colors.danger} />
        <Text style={styles.errorText}>{message}</Text>
      </View>
      <Button
        label="Tekrar dene"
        tone="neutral"
        size="small"
        block={false}
        onPress={onRetry}
        accessibilityLabel="Tekrar dene"
      />
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...type.title, color: colors.text },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    // A stronger outline than a card's: this is a control, and it has to look like
    // the one thing on the screen the user is meant to touch first.
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  // Turns primary once there is a query, which is the only "active" cue available
  // without tracking focus state and changing behaviour.
  searchBoxActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  searchInput: { ...type.body, color: colors.text, flex: 1, paddingVertical: spacing.md },

  hint: { ...type.caption, color: colors.textFaint },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  noticeText: { ...type.caption, color: colors.accentDark, flex: 1 },

  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  sectionBody: { gap: spacing.sm },

  inlineLoader: { marginTop: spacing.xl },
  empty: { ...type.body, color: colors.textFaint, paddingVertical: spacing.md },

  coldStart: { ...cardStyle, padding: spacing.lg, gap: spacing.sm },
  coldStartTitle: { ...type.heading, color: colors.text },
  coldStartBody: { ...type.body, color: colors.textMuted },
  coldStartList: { gap: spacing.sm, marginTop: spacing.xs },
  coldStartItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  coldStartItemText: { ...type.body, color: colors.textMuted, flex: 1 },
  coldStartFooter: { ...type.caption, color: colors.textFaint, marginTop: spacing.xs },

  trailingLabelGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  trailingLabel: { ...type.caption, color: colors.textMuted },

  errorBlock: { gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
});
