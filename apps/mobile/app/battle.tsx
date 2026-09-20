/**
 * The battle screen (spec Section 9, Tab 3).
 *
 * Deliberately missing: the league ladder. The spec's league system needs five
 * tiers of thirty weekly-active users — 150 people active in the same week — and
 * the product has nowhere near that. An empty "Bronz Ligi" with two names in it
 * teaches the user that competition here is dead, which is worse than not showing
 * it at all. The audit signed off on shipping without it. The friends leaderboard
 * takes the top slot instead: it works with one friend, and it is the same
 * motivation (someone you know is ahead of you) at a scale that actually exists.
 *
 * Also absent for the same reason: the guild panel. Guilds are 5–30 people.
 *
 * What is here, in priority order: the season banner (when there is a season),
 * the friends leaderboard, active duels, and the form to start one.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ApiError } from '../src/api/client';
import { getProfile } from '../src/api/profile';
import {
  acceptChallenge,
  createChallenge,
  declineChallenge,
  describeCategory,
  getCurrentSeason,
  getFriendsLeaderboard,
  listChallenges,
  listFriends,
  normaliseChallenges,
  normaliseFriends,
  normaliseLeaderboard,
  normaliseSeason,
  type Challenge,
} from '../src/api/social';
import { DuelCard } from '../src/components/DuelCard';
import { UserRow } from '../src/components/UserRow';
import { colors, radius, spacing, type } from '../src/theme';

import type { Category } from '@habitwar/domain';

/** Spec 5.4: a duel runs 3–7 days. */
const DUEL_DAY_OPTIONS: readonly number[] = [3, 5, 7];

const CATEGORY_OPTIONS: readonly Category[] = [
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'CREATIVE',
  'SOCIAL',
  'HEALTH',
  'SKILL',
];

/** Duels a user should still be looking at. Finished and refused ones fall away. */
function isLiveDuel(challenge: Challenge): boolean {
  return challenge.status === 'ACTIVE' || challenge.status === 'PENDING';
}

export default function BattleScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [opponent, setOpponent] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [days, setDays] = useState<number>(DUEL_DAY_OPTIONS[0] ?? 3);

  // The viewer's own id decides which half of a duel bar is "you" and which
  // leaderboard row is highlighted. Shares the cache key with the profile tab.
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const seasonQuery = useQuery({ queryKey: ['currentSeason'], queryFn: getCurrentSeason });
  const leaderboardQuery = useQuery({
    queryKey: ['friendsLeaderboard'],
    queryFn: getFriendsLeaderboard,
  });
  const challengesQuery = useQuery({ queryKey: ['challenges'], queryFn: listChallenges });
  const friendsQuery = useQuery({ queryKey: ['friends'], queryFn: listFriends });

  const viewerId = profileQuery.data?.user?.id ?? null;
  const season = useMemo(() => normaliseSeason(seasonQuery.data?.season), [seasonQuery.data]);
  // The board is nested under `leaderboard` alongside the week window it covers.
  const entries = useMemo(
    () =>
      normaliseLeaderboard(
        leaderboardQuery.data?.leaderboard?.entries ?? leaderboardQuery.data?.entries,
      ),
    [leaderboardQuery.data],
  );

  // Duels arrive split into `active` and `past` because the two render differently
  // server-side; the live filter below is what this screen actually needs.
  const duels = useMemo(() => {
    const payload = challengesQuery.data;
    const merged = [
      ...(payload?.active ?? []),
      ...(payload?.past ?? []),
      ...(payload?.challenges ?? []),
    ];
    return normaliseChallenges(merged).filter(isLiveDuel);
  }, [challengesQuery.data]);
  const friends = useMemo(() => normaliseFriends(friendsQuery.data?.friends), [friendsQuery.data]);

  function refreshBattle(): void {
    void queryClient.invalidateQueries({ queryKey: ['challenges'] });
    void queryClient.invalidateQueries({ queryKey: ['friendsLeaderboard'] });
  }

  const createMutation = useMutation({
    mutationFn: (input: { opponentUsername: string; category: Category; days: number }) =>
      createChallenge(input),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice('Düello daveti gönderildi.');
      setComposerOpen(false);
      setOpponent(null);
      setCategory(null);
      refreshBattle();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const acceptMutation = useMutation({
    mutationFn: (challengeId: string) => acceptChallenge(challengeId),
    onSuccess: () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setNotice('Düello başladı.');
      refreshBattle();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const declineMutation = useMutation({
    mutationFn: (challengeId: string) => declineChallenge(challengeId),
    onSuccess: () => {
      setNotice('Davet reddedildi.');
      refreshBattle();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const busy = createMutation.isPending || acceptMutation.isPending || declineMutation.isPending;
  const canSubmit = opponent !== null && category !== null && !busy;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Savaş</Text>

        {/* Season banner. Hidden entirely when there is no season — an empty banner
            is worse than no banner. */}
        {season !== null && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.seasonBanner}>
            <Text style={styles.seasonLabel}>Aktif sezon</Text>
            <Text style={styles.seasonName}>{season.name}</Text>
            {season.theme !== null && <Text style={styles.seasonTheme}>{season.theme}</Text>}
            {season.eventMultiplier !== null && (
              <View style={styles.multiplierPill}>
                <Text style={styles.multiplierText}>
                  Etkinlik çarpanı ×{season.eventMultiplier.toFixed(season.eventMultiplier % 1 === 0 ? 0 : 1)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {notice !== null && (
          <Pressable
            onPress={() => setNotice(null)}
            accessibilityRole="button"
            accessibilityLabel="Bildirimi kapat"
          >
            <Text style={styles.notice}>{notice}</Text>
          </Pressable>
        )}

        {/* --- Friends leaderboard: the headline of this screen. --- */}
        <Section title="Arkadaş sıralaması" subtitle="Bu haftaki XP">
          {leaderboardQuery.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
          ) : leaderboardQuery.isError ? (
            <ErrorBlock
              message={describeError(leaderboardQuery.error)}
              onRetry={() => void leaderboardQuery.refetch()}
            />
          ) : entries.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Sıralama için arkadaş gerek</Text>
              <Text style={styles.emptyBody}>
                Arkadaş ekledikçe haftalık XP sıralaman burada oluşur. Sıralama her pazartesi
                sıfırlanır.
              </Text>
            </View>
          ) : (
            entries.map((entry, index) => (
              <Animated.View key={entry.user.id} entering={FadeInDown.delay(index * 40).duration(280)}>
                <UserRow
                  user={entry.user}
                  highlighted={viewerId !== null && entry.user.id === viewerId}
                  leading={
                    <Text
                      style={[
                        styles.rank,
                        viewerId !== null && entry.user.id === viewerId && styles.rankMine,
                      ]}
                    >
                      {entry.rank}
                    </Text>
                  }
                  trailing={<Text style={styles.weeklyXp}>{entry.weeklyXp} XP</Text>}
                />
              </Animated.View>
            ))
          )}
        </Section>

        {/* --- Active duels --- */}
        <Section title="Düellolar">
          {challengesQuery.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
          ) : challengesQuery.isError ? (
            <ErrorBlock
              message={describeError(challengesQuery.error)}
              onRetry={() => void challengesQuery.refetch()}
            />
          ) : duels.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Aktif düello yok</Text>
              <Text style={styles.emptyBody}>
                Bir arkadaşını seç, kategori ve süre belirle; kim daha çok XP toplarsa kazanır.
              </Text>
            </View>
          ) : (
            duels.map((duel) => (
              <DuelCard
                key={duel.id}
                challenge={duel}
                viewerId={viewerId}
                onAccept={(id) => acceptMutation.mutate(id)}
                onDecline={(id) => declineMutation.mutate(id)}
                busy={busy}
              />
            ))
          )}
        </Section>

        {/* --- Duel composer --- */}
        {!composerOpen ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setComposerOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Yeni düello başlat"
          >
            <Text style={styles.primaryButtonText}>Düello başlat</Text>
          </Pressable>
        ) : (
          <Animated.View entering={FadeInDown.duration(280)} style={styles.composer}>
            <View style={styles.composerHeader}>
              <Text style={styles.composerTitle}>Yeni düello</Text>
              <Pressable
                onPress={() => setComposerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Düello oluşturmayı kapat"
                hitSlop={spacing.sm}
              >
                <Text style={styles.closeIcon}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Rakip</Text>
            {friendsQuery.isPending ? (
              <ActivityIndicator color={colors.accent} />
            ) : friendsQuery.isError ? (
              <ErrorBlock
                message={describeError(friendsQuery.error)}
                onRetry={() => void friendsQuery.refetch()}
              />
            ) : friends.length === 0 ? (
              <Text style={styles.emptyBody}>
                Düello için önce arkadaş eklemelisin. Arkadaşlar sekmesinden kullanıcı adı arayarak
                başlayabilirsin.
              </Text>
            ) : (
              <View style={styles.chipRow}>
                {friends.map((friend) => {
                  const selected = opponent === friend.user.username;
                  return (
                    <Pressable
                      key={friend.friendshipId}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => setOpponent(selected ? null : friend.user.username)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rakip olarak ${friend.user.displayName} seç`}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {friend.user.displayName}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.fieldLabel}>Kategori</Text>
            <View style={styles.chipRow}>
              {CATEGORY_OPTIONS.map((option) => {
                const selected = category === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setCategory(selected ? null : option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Kategori ${describeCategory(option)}`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {describeCategory(option)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Süre</Text>
            <View style={styles.chipRow}>
              {DUEL_DAY_OPTIONS.map((option) => {
                const selected = days === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setDays(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`${option} günlük düello`}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option} gün
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
              disabled={!canSubmit}
              onPress={() => {
                // Narrowed here rather than trusting `canSubmit`: the compiler cannot
                // see through the boolean, and a null username would 400.
                if (opponent === null || category === null) return;
                createMutation.mutate({ opponentUsername: opponent, category, days });
              }}
              accessibilityRole="button"
              accessibilityLabel="Düello davetini gönder"
            >
              <Text style={styles.primaryButtonText}>
                {createMutation.isPending ? 'Gönderiliyor…' : 'Daveti gönder'}
              </Text>
            </Pressable>

            {!canSubmit && !busy && (
              <Text style={styles.hint}>Rakip ve kategori seçtiğinde davet gönderilebilir.</Text>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle !== undefined && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
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

  seasonBanner: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: spacing.xs,
  },
  seasonLabel: {
    ...type.caption,
    color: colors.accentBright,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  seasonName: { ...type.heading, color: colors.text },
  seasonTheme: { ...type.body, color: colors.textMuted },
  multiplierPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  multiplierText: { ...type.caption, color: '#FFFFFF' },

  notice: {
    ...type.caption,
    color: colors.accentBright,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },

  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: {
    ...type.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionSubtitle: { ...type.caption, color: colors.textFaint },
  sectionBody: { gap: spacing.sm },

  inlineLoader: { marginTop: spacing.lg },

  rank: {
    ...type.label,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    minWidth: 20,
    textAlign: 'center',
  },
  rankMine: { color: colors.accentBright },
  weeklyXp: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'] },

  emptyCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  emptyTitle: { ...type.heading, color: colors.text },
  emptyBody: { ...type.body, color: colors.textMuted },

  composer: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  composerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  composerTitle: { ...type.heading, color: colors.text },
  closeIcon: { ...type.label, color: colors.textFaint },
  fieldLabel: { ...type.caption, color: colors.textMuted, marginTop: spacing.sm },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.label, color: colors.textMuted },
  chipTextSelected: { color: '#FFFFFF' },

  primaryButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: { ...type.heading, color: '#FFFFFF' },
  buttonDisabled: { opacity: 0.5 },
  hint: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

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
