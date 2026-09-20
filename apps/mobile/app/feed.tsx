/**
 * The feed tab (spec §9, Tab 2).
 *
 * Three things drive the design here:
 *
 *  1. **Scope is a hard split, not a filter.** "Arkadaşlar" and "Keşfet" are separate
 *     cursors and separate caches, so switching tabs never mixes pages or re-fetches
 *     what the user already scrolled past.
 *
 *  2. **The cold start is the hard case.** A new user's friends feed is empty by
 *     definition, and an empty screen that just says "gönderi yok" teaches them
 *     nothing. The empty state therefore points at the fix — add someone, or go to
 *     Keşfet — which is the only thing that makes the tab recoverable.
 *
 *  3. **Likes are optimistic.** A like that waits on a round trip feels broken, so the
 *     cache is patched immediately and rolled back on failure. Rollback restores the
 *     exact snapshot rather than decrementing, so a concurrent refetch cannot leave the
 *     counter drifting.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import {
  blockUser,
  createPost,
  fetchFeed,
  likePost,
  reportContent,
  unlikePost,
  type FeedPage,
  type FeedScope,
  type Post,
  type ReportReason,
} from '../src/api/feed';
import { ComposePost } from '../src/components/ComposePost';
import { PostCard } from '../src/components/PostCard';
import { colors, radius, spacing, type } from '../src/theme';

type FeedQueryData = InfiniteData<FeedPage, string | null>;

const feedKey = (scope: FeedScope): readonly unknown[] => ['feed', scope];

const SCOPES: readonly { readonly value: FeedScope; readonly label: string }[] = [
  { value: 'friends', label: 'Arkadaşlar' },
  { value: 'discover', label: 'Keşfet' },
];

export default function FeedScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<FeedScope>('friends');
  const [composeError, setComposeError] = useState<string | null>(null);

  const feedQuery = useInfiniteQuery({
    queryKey: feedKey(scope),
    queryFn: ({ pageParam, signal }) =>
      fetchFeed({ scope, cursor: pageParam ?? undefined, signal }),
    initialPageParam: null as string | null,
    // Returning undefined is what stops `hasNextPage`; a null cursor means the end.
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor ?? undefined,
  });

  // Flattening here (rather than in render) keeps FlatList's data reference stable
  // across unrelated re-renders, which matters once the list is long.
  const posts = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.posts) ?? [],
    [feedQuery.data],
  );

  /**
   * Patch one post everywhere it appears in the cached pages.
   *
   * Returns the previous cache so the caller can roll back byte-for-byte.
   */
  const patchPost = useCallback(
    (postId: string, update: (post: Post) => Post): FeedQueryData | undefined => {
      const key = feedKey(scope);
      const previous = queryClient.getQueryData<FeedQueryData>(key);

      queryClient.setQueryData<FeedQueryData>(key, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            posts: page.posts.map((post) => (post.id === postId ? update(post) : post)),
          })),
        };
      });

      return previous;
    },
    [queryClient, scope],
  );

  const likeMutation = useMutation({
    mutationFn: (post: Post) => (post.likedByMe ? unlikePost(post.id) : likePost(post.id)),

    onMutate: async (post: Post) => {
      // Cancel in-flight fetches first: a refetch landing after the patch would
      // overwrite the optimistic value with the stale server one.
      await queryClient.cancelQueries({ queryKey: feedKey(scope) });

      const previous = patchPost(post.id, (current) => ({
        ...current,
        likedByMe: !current.likedByMe,
        // Clamp at zero — a server count that is already 0 must not go negative if
        // the client's `likedByMe` was stale.
        likeCount: current.likedByMe
          ? Math.max(0, current.likeCount - 1)
          : current.likeCount + 1,
      }));

      return { previous, key: feedKey(scope) };
    },

    onError: (_error, _post, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },

    // Deliberately no invalidate on success: the optimistic value is already correct
    // and a refetch would jump the whole list back to page one.
  });

  const composeMutation = useMutation({
    mutationFn: (content: string) => createPost({ content }),
    onSuccess: (post: Post) => {
      setComposeError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Prepend locally so the new post is visible immediately. The friends feed is
      // the only scope where the author's own post certainly belongs.
      queryClient.setQueryData<FeedQueryData>(feedKey('friends'), (current) => {
        if (!current || current.pages.length === 0) return current;
        const [first, ...rest] = current.pages;
        if (!first) return current;
        return {
          ...current,
          pages: [{ ...first, posts: [post, ...first.posts] }, ...rest],
        };
      });
    },
    onError: (error: unknown) => setComposeError(describeError(error)),
  });

  const reportMutation = useMutation({
    mutationFn: (input: { post: Post; reason: ReportReason }) =>
      reportContent({ targetType: 'POST', targetId: input.post.id, reason: input.reason }),
    onSuccess: () => {
      Alert.alert(
        'Bildirimin alındı',
        'Ekibimiz gönderiyi inceleyecek. Teşekkür ederiz.',
      );
    },
    onError: (error: unknown) => Alert.alert('Şikayet gönderilemedi', describeError(error)),
  });

  const blockMutation = useMutation({
    mutationFn: (post: Post) => blockUser(post.author.username),
    onSuccess: (_result, post) => {
      // Drop the blocked author's posts from the cache right away. Waiting for a
      // refetch would leave the user staring at content they just blocked.
      for (const value of ['friends', 'discover'] as const) {
        queryClient.setQueryData<FeedQueryData>(feedKey(value), (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              posts: page.posts.filter((item) => item.author.id !== post.author.id),
            })),
          };
        });
      }
      Alert.alert('Engellendi', `@${post.author.username} artık seni göremeyecek.`);
    },
    onError: (error: unknown) => Alert.alert('Engellenemedi', describeError(error)),
  });

  const handleToggleLike = useCallback(
    (post: Post) => likeMutation.mutate(post),
    [likeMutation],
  );
  const handleReport = useCallback(
    (post: Post, reason: ReportReason) => reportMutation.mutate({ post, reason }),
    [reportMutation],
  );
  const handleBlock = useCallback((post: Post) => blockMutation.mutate(post), [blockMutation]);

  const handleEndReached = useCallback(() => {
    // Guard on isFetchingNextPage: FlatList fires onEndReached more than once while
    // the user keeps scrolling, and each call would start a duplicate page request.
    if (feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
      void feedQuery.fetchNextPage();
    }
  }, [feedQuery]);

  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <PostCard
        post={item}
        onToggleLike={handleToggleLike}
        onReport={handleReport}
        onBlock={handleBlock}
      />
    ),
    [handleToggleLike, handleReport, handleBlock],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Akış</Text>

          <View style={styles.segment} accessibilityRole="tablist">
            {SCOPES.map((item) => {
              const active = item.value === scope;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => {
                    if (active) return;
                    void Haptics.selectionAsync();
                    setScope(item.value);
                  }}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${item.label} akışı`}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {feedQuery.isPending ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : feedQuery.isError ? (
          <View style={styles.centered}>
            <Text style={styles.stateTitle}>Akış yüklenemedi</Text>
            <Text style={styles.stateBody}>{describeError(feedQuery.error)}</Text>
            <Pressable
              onPress={() => void feedQuery.refetch()}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Akışı yeniden yükle"
            >
              <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(post) => post.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <ComposePost
                onSubmit={(content) => composeMutation.mutate(content)}
                isSubmitting={composeMutation.isPending}
                errorMessage={composeError}
              />
            }
            ListEmptyComponent={<EmptyFeed scope={scope} onGoDiscover={() => setScope('discover')} />}
            ListFooterComponent={
              feedQuery.isFetchingNextPage ? (
                <ActivityIndicator style={styles.footerSpinner} color={colors.accent} />
              ) : null
            }
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.6}
            refreshControl={
              <RefreshControl
                refreshing={feedQuery.isRefetching && !feedQuery.isFetchingNextPage}
                onRefresh={() => void feedQuery.refetch()}
                tintColor={colors.accent}
              />
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * The empty state.
 *
 * Worded per scope, because the two emptinesses have different causes and different
 * fixes: a friends feed is empty because there is no graph yet, a discover feed is
 * empty because the server had nothing to show.
 */
function EmptyFeed({
  scope,
  onGoDiscover,
}: {
  readonly scope: FeedScope;
  readonly onGoDiscover: () => void;
}): React.JSX.Element {
  if (scope === 'friends') {
    return (
      <View style={styles.empty}>
        <Text style={styles.stateTitle}>Henüz arkadaşın yok</Text>
        <Text style={styles.stateBody}>
          Akış, arkadaşlarının seansları ve paylaşımlarıyla dolar. Birini ekle ya da
          Keşfet’ten başlayarak yeni insanlar bul.
        </Text>
        <Pressable
          onPress={onGoDiscover}
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel="Keşfet akışına geç"
        >
          <Text style={styles.secondaryButtonText}>Keşfet’e göz at</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Text style={styles.stateTitle}>Burası şimdilik sessiz</Text>
      <Text style={styles.stateBody}>
        Keşfet’te gösterilecek yeni bir şey yok. İlk paylaşımı sen yapabilirsin —
        yukarıdaki kutuya yaz.
      </Text>
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
  flex: { flex: 1 },

  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  title: { ...type.title, color: colors.text },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  segmentItemActive: { backgroundColor: colors.accent },
  segmentText: { ...type.label, color: colors.textMuted },
  segmentTextActive: { color: '#FFFFFF' },

  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  footerSpinner: { marginVertical: spacing.lg },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },

  stateTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  stateBody: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },

  secondaryButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  secondaryButtonText: { ...type.label, color: colors.text },
});
