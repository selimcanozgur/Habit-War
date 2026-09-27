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

import { Ionicons } from '@expo/vector-icons';
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
import { Button, ChipButton, cardStyle } from '../src/components/Button';
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

const ICON_SIZE = 20;
/** Medals for the top three. Rank 4 and below get their number, not a metal. */
const PODIUM_COLORS: readonly string[] = [colors.warning, colors.textMuted, colors.accentBright];

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
        <View style={styles.titleRow}>
          <Ionicons name="flame" size={28} color={colors.warning} />
          <Text style={styles.title}>Savaş</Text>
        </View>

        {/* Season banner. Hidden entirely when there is no season — an empty banner
            is worse than no banner. The soft primary ground is what marks it as the
            one piece of standing context on the screen rather than another card. */}
        {season !== null && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.seasonBanner}>
            <View style={styles.seasonHeader}>
              <Ionicons name="calendar" size={ICON_SIZE} color={colors.accent} />
              <Text style={styles.seasonLabel}>Aktif sezon</Text>
            </View>
            <Text style={styles.seasonName}>{season.name}</Text>
            {season.theme !== null && <Text style={styles.seasonTheme}>{season.theme}</Text>}
            {season.eventMultiplier !== null && (
              <View style={styles.multiplierPill}>
                <Ionicons name="flash" size={ICON_SIZE - 4} color={colors.textOnAccent} />
                <Text style={styles.multiplierText}>
                  Etkinlik çarpanı ×{season.eventMultiplier.toFixed(season.eventMultiplier % 1 === 0 ? 0 : 1)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {notice !== null && <Notice message={notice} onDismiss={() => setNotice(null)} />}

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
            <EmptyCard
              icon="podium-outline"
              title="Sıralama için arkadaş gerek"
              body="Arkadaş ekledikçe haftalık XP sıralaman burada oluşur. Sıralama her pazartesi sıfırlanır."
            />
          ) : (
            entries.map((entry, index) => {
              const isViewer = viewerId !== null && entry.user.id === viewerId;
              return (
                <Animated.View key={entry.user.id} entering={FadeInDown.delay(index * 40).duration(280)}>
                  <UserRow
                    user={entry.user}
                    highlighted={isViewer}
                    leading={<RankBadge rank={entry.rank} highlighted={isViewer} />}
                    trailing={
                      <View style={styles.weeklyXpPill}>
                        <Text style={styles.weeklyXpValue}>{entry.weeklyXp}</Text>
                        <Text style={styles.weeklyXpUnit}>XP</Text>
                      </View>
                    }
                  />
                </Animated.View>
              );
            })
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
            <EmptyCard
              icon="flash-outline"
              title="Aktif düello yok"
              body="Bir arkadaşını seç, kategori ve süre belirle; kim daha çok XP toplarsa kazanır."
            />
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
          <Button
            label="Düello başlat"
            onPress={() => {
              // The composer's own open animation carries no feedback of its own, so
              // the tap is acknowledged here as well as by the button's press.
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setComposerOpen(true);
            }}
            accessibilityLabel="Yeni düello başlat"
            style={styles.launchButton}
          />
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
                <Ionicons name="close" size={ICON_SIZE + 2} color={colors.textMuted} />
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
                    <ChipButton
                      key={friend.friendshipId}
                      label={friend.user.displayName}
                      // A selected chip takes the primary tone, which gives it the
                      // accent fill and white label — the same "this is chosen" cue
                      // the rest of the app uses.
                      tone={selected ? 'primary' : 'neutral'}
                      onPress={() => setOpponent(selected ? null : friend.user.username)}
                      accessibilityLabel={`Rakip olarak ${friend.user.displayName} seç`}
                    />
                  );
                })}
              </View>
            )}

            <Text style={styles.fieldLabel}>Kategori</Text>
            <View style={styles.chipRow}>
              {CATEGORY_OPTIONS.map((option) => {
                const selected = category === option;
                return (
                  <ChipButton
                    key={option}
                    label={describeCategory(option)}
                    tone={selected ? 'primary' : 'neutral'}
                    onPress={() => setCategory(selected ? null : option)}
                    accessibilityLabel={`Kategori ${describeCategory(option)}`}
                  />
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Süre</Text>
            <View style={styles.chipRow}>
              {DUEL_DAY_OPTIONS.map((option) => {
                const selected = days === option;
                return (
                  <ChipButton
                    key={option}
                    label={`${option} gün`}
                    tone={selected ? 'primary' : 'neutral'}
                    onPress={() => setDays(option)}
                    accessibilityLabel={`${option} günlük düello`}
                  />
                );
              })}
            </View>

            <Button
              // The pending label is kept rather than handing the button its `loading`
              // spinner: "Gönderiliyor…" says what is happening, a spinner does not.
              label={createMutation.isPending ? 'Gönderiliyor…' : 'Daveti gönder'}
              disabled={!canSubmit}
              onPress={() => {
                // Narrowed here rather than trusting `canSubmit`: the compiler cannot
                // see through the boolean, and a null username would 400.
                if (opponent === null || category === null) return;
                createMutation.mutate({ opponentUsername: opponent, category, days });
              }}
              accessibilityLabel="Düello davetini gönder"
              style={styles.submitButton}
            />

            {!canSubmit && !busy && (
              <Text style={styles.hint}>Rakip ve kategori seçtiğinde davet gönderilebilir.</Text>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Leaderboard rank.
 *
 * A filled disc rather than a bare number: at 12px a digit beside a 44px avatar has
 * no presence, and the top three earn a metal so the podium is readable before any
 * name is. The viewer's own rank is always the primary colour, whatever it is.
 */
function RankBadge({
  rank,
  highlighted,
}: {
  readonly rank: number;
  readonly highlighted: boolean;
}): React.JSX.Element {
  const podium = PODIUM_COLORS[rank - 1];
  const fill = highlighted ? colors.accent : (podium ?? colors.surfaceSunken);
  const onPodium = highlighted || podium !== undefined;

  return (
    <View style={[styles.rankBadge, { backgroundColor: fill }]}>
      <Text style={[styles.rankText, onPodium ? styles.rankTextOnFill : null]}>{rank}</Text>
    </View>
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

function EmptyCard({
  icon,
  title,
  body,
}: {
  readonly icon: React.ComponentProps<typeof Ionicons>['name'];
  readonly title: string;
  readonly body: string;
}): React.JSX.Element {
  return (
    <View style={styles.emptyCard}>
      <Ionicons name={icon} size={ICON_SIZE + 4} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
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

  seasonBanner: {
    ...cardStyle,
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    gap: spacing.xs,
  },
  seasonHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  seasonLabel: { ...type.overline, color: colors.accentDark, textTransform: 'uppercase' },
  seasonName: { ...type.heading, color: colors.text },
  seasonTheme: { ...type.body, color: colors.textMuted },
  multiplierPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  multiplierText: { ...type.label, color: colors.textOnAccent },

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
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionTitle: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  sectionSubtitle: { ...type.caption, color: colors.textFaint },
  sectionBody: { gap: spacing.sm },

  inlineLoader: { marginTop: spacing.lg },

  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rankTextOnFill: { color: colors.textOnAccent },

  weeklyXpPill: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  weeklyXpValue: { ...type.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  weeklyXpUnit: { ...type.caption, color: colors.textFaint },

  emptyCard: { ...cardStyle, gap: spacing.xs, alignItems: 'flex-start' },
  emptyTitle: { ...type.heading, color: colors.text },
  emptyBody: { ...type.body, color: colors.textMuted },

  composer: { ...cardStyle, gap: spacing.sm },
  composerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  composerTitle: { ...type.heading, color: colors.text },
  fieldLabel: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase', marginTop: spacing.sm },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

  launchButton: { marginTop: spacing.sm },
  submitButton: { marginTop: spacing.sm },
  hint: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

  errorBlock: { gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
});
