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
 * What is here, in priority order: the monster hunt and the bestiary, the season banner (when there is a season),
 * the friends leaderboard, active duels, and the form to start one. Duels are behind
 * `FEATURES.duels`, off for now.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { router } from 'expo-router';

import { getBestiary, startHunt } from '../../src/api/monsters';
import { ApiError } from '../../src/api/client';
import { listHabits, startSession } from '../../src/api/sessions';
import { getProfile } from '../../src/api/profile';
import {
  acceptChallenge,
  checkInChallenge,
  declineChallenge,
  disputeCheckIn,
  describeCategory,
  getCurrentSeason,
  getFriendsLeaderboard,
  listChallenges,
  normaliseChallenges,
  normaliseLeaderboard,
  normaliseSeason,
  type Challenge,
} from '../../src/api/social';
import { HuntCard } from '../../src/components/HuntCard';
import { MonsterBook } from '../../src/components/MonsterBook';
import { Button, cardStyle } from '../../src/components/Button';
import { DuelComposer } from '../../src/components/DuelComposer';
import { DuelCard } from '../../src/components/DuelCard';
import { Icon, type IconName } from '../../src/components/Icon';
import { ScreenHero } from '../../src/components/ScreenHero';
import { Group } from '../../src/components/Group';
import { UserRow } from '../../src/components/UserRow';
import { FEATURES } from '../../src/features';
import { useTimerStore } from '../../src/stores/timer';
import { colors, radius, spacing, type } from '../../src/theme';


const ICON_SIZE = 20;
/** The crossed swords in the season banner, sized as an emblem rather than a label. */
const SEASON_EMBLEM_SIZE = 28;
/** Group separator start for a leaderboard row: past the rank disc and the avatar. */
const LEADERBOARD_INSET = spacing.md + 28 + spacing.md + 40 + spacing.md;
/**
 * Medals for the top three — gold, silver, bronze. Rank 4 and below get their
 * number on a plain parchment disc, not a metal they did not earn.
 */
const PODIUM_COLORS: readonly string[] = [colors.gold, colors.textFaint, colors.fireDark];

/** Duels a user should still be looking at. Finished and refused ones fall away. */
function isLiveDuel(challenge: Challenge): boolean {
  return challenge.status === 'ACTIVE' || challenge.status === 'PENDING';
}

export default function BattleScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // The viewer's own id decides which half of a duel bar is "you" and which
  // leaderboard row is highlighted. Shares the cache key with the profile tab.
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const seasonQuery = useQuery({ queryKey: ['currentSeason'], queryFn: getCurrentSeason });
  const bestiaryQuery = useQuery({ queryKey: ['monsters'], queryFn: getBestiary });
  const bestiary = bestiaryQuery.data ?? null;
  const huntMutation = useMutation({
    mutationFn: (monsterKey: string) => startHunt(monsterKey),
    onSuccess: ({ hunt }) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(`Hedefin artık ${hunt.name}. "Savaşa başla" ile ilk vuruşu yap.`);
      void queryClient.invalidateQueries({ queryKey: ['monsters'] });
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });
  const leaderboardQuery = useQuery({
    queryKey: ['friendsLeaderboard'],
    queryFn: getFriendsLeaderboard,
  });
  const challengesQuery = useQuery({
    queryKey: ['challenges'],
    queryFn: listChallenges,
    enabled: FEATURES.duels,
  });

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

  function refreshBattle(): void {
    void queryClient.invalidateQueries({ queryKey: ['challenges'] });
    void queryClient.invalidateQueries({ queryKey: ['friendsLeaderboard'] });
  }

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

  /**
   * A duel scores sessions in its category, and those are run from the Bugün timer.
   * The card's action is the bridge: it starts a session on the user's habit in that
   * category and hands over to Bugün, where the timer already lives — or, with no such
   * habit, opens the add form there with the category chosen.
   */
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const sessionRunning = useTimerStore((state) => state.sessionId !== null);
  const startMutation = useMutation({
    mutationFn: (habitId: string) =>
      startSession({ habitId, clientRequestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }),
    onSuccess: ({ session }) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      useTimerStore.getState().start({
        sessionId: session.id,
        habitId: session.habitId,
        startedAt: session.startedAt,
      });
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      router.navigate('/');
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  function duelAction(duel: Challenge): { label: string; onPress: () => void } | undefined {
    if (duel.status !== 'ACTIVE' || duel.category === null) return undefined;
    const category = duel.category;
    const habit = habitsQuery.data?.habits.find((item) => item.category === category);
    if (habit) {
      return { label: `${habit.name} seansı başlat`, onPress: () => startMutation.mutate(habit.id) };
    }
    return {
      label: `${describeCategory(category)} alışkanlığı ekle`,
      // `at` makes every request distinct, so asking twice for the same category still
      // opens the form the second time.
      onPress: () =>
        router.navigate({ pathname: '/', params: { add: category, at: String(Date.now()) } }),
    };
  }

  const checkInMutation = useMutation({
    mutationFn: (challengeId: string) => checkInChallenge(challengeId),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshBattle();
      // The day's XP lands on the profile and the Bugün banner.
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const disputeMutation = useMutation({
    mutationFn: (input: { challengeId: string; checkInId: string }) =>
      disputeCheckIn(input.challengeId, input.checkInId),
    onSuccess: () => {
      setNotice('İtiraz edildi. O gün rakibinin skoruna sayılmayacak.');
      refreshBattle();
    },
    onError: (error: unknown) => setNotice(describeError(error)),
  });

  const busy =
    acceptMutation.isPending ||
    declineMutation.isPending ||
    startMutation.isPending ||
    checkInMutation.isPending ||
    disputeMutation.isPending;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHero image="battle" title="Savaş" icon="flame-filled" />

        <View style={styles.body}>
        {/* The hunt leads: it is what this tab is for now. */}
        {bestiary !== null &&
          (bestiary.active !== null ? (
            <HuntCard
              hunt={bestiary.active}
              habits={habitsQuery.data?.habits ?? []}
              sessionRunning={sessionRunning}
              busy={startMutation.isPending}
              // Starting a session here goes straight to its timer on Bugün, where
              // the monster's HP drains as the minutes run.
              onFight={(habitId) => startMutation.mutate(habitId)}
              onResume={() => router.navigate('/')}
              onAddHabit={(category) =>
                router.navigate({
                  pathname: '/',
                  params: { add: category ?? 'any', at: String(Date.now()) },
                })
              }
            />
          ) : (
            <EmptyCard
              icon="swords"
              title="Avlanacak bir canavar seç"
              body="Aşağıdaki kitaptan bir canavar seç. Tamamladığın her seans ona vurur."
            />
          ))}

        {notice !== null && <Notice message={notice} onDismiss={() => setNotice(null)} />}

        {bestiary !== null && (
          <Section title="Canavar Kitabı" subtitle={`Seviyen ${bestiary.playerLevel}`}>
            <MonsterBook
              monsters={bestiary.monsters}
              active={bestiary.active}
              busy={huntMutation.isPending}
              onHunt={(key) => huntMutation.mutate(key)}
            />
          </Section>
        )}

        {/* Season banner. Hidden entirely when there is no season — an empty banner
            is worse than no banner. A plain card: theme and multiplier are one line of
            text, the gold emblem is the only ornament. */}
        {season !== null && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.seasonBanner}>
            <View style={styles.seasonText}>
              <Text style={styles.seasonLabel}>Aktif sezon</Text>
              <Text style={styles.seasonName} numberOfLines={2}>
                {season.name}
              </Text>

              {(season.theme !== null || season.eventMultiplier !== null) && (
                <Text style={styles.seasonMeta}>
                  {[
                    season.theme,
                    season.eventMultiplier !== null
                      ? `Etkinlik çarpanı ×${season.eventMultiplier.toFixed(season.eventMultiplier % 1 === 0 ? 0 : 1)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              )}
            </View>

            {/* The crossed swords are the banner's emblem, so they are sized as an
                object rather than as a label's icon. */}
            <View style={styles.seasonEmblem}>
              <Icon name="swords" size={SEASON_EMBLEM_SIZE} color={colors.goldDark} />
            </View>
          </Animated.View>
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
            <EmptyCard
              icon="trophy"
              title="Sıralama için arkadaş gerek"
              body="Arkadaş ekledikçe haftalık XP sıralaman burada oluşur. Sıralama her pazartesi sıfırlanır."
            />
          ) : (
            <Group inset={LEADERBOARD_INSET}>
            {entries.map((entry, index) => {
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
            })}
            </Group>
          )}
        </Section>

        {/* Duels are behind a feature flag while the product starts with solo habits;
            the leaderboard above stands on its own. */}
        {FEATURES.duels && (
          <>
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
                icon="swords"
                title="Aktif düello yok"
                body="Bir arkadaşını seç, günlük bir görev belirle; her gün yapan puan alır, en çok günü olan kazanır."
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
                  action={duelAction(duel)}
                  onCheckIn={(id) => checkInMutation.mutate(id)}
                  onDispute={(challengeId, checkInId) =>
                    disputeMutation.mutate({ challengeId, checkInId })
                  }
                />
              ))
            )}
          </Section>

          {/* --- Duel composer --- */}
          {!composerOpen ? (
            <Button
              label="Düello başlat"
              // Violet: starting a duel spends progression rather than merely
              // navigating, which is what this tone means everywhere else.
              tone="xp"
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
                  <Icon name="x" size={ICON_SIZE - 2} color={colors.textMuted} />
                </Pressable>
              </View>

              <DuelComposer
                onCreated={() => {
                  setNotice('Düello daveti gönderildi.');
                  setComposerOpen(false);
                }}
              />
            </Animated.View>
          )}
          </>
        )}
        </View>
      </ScrollView>
    </View>
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
  // Only the podium earns a disc; below it the rank is a plain number, which is all
  // it needs to say.
  const fill = podium ?? 'transparent';
  const onMetal = podium !== undefined;

  return (
    <View
      style={[
        styles.rankBadge,
        { backgroundColor: fill },
        // The viewer's own medallion keeps its metal but gains a ring, so "you" is
        // legible without overwriting the rank it earned.
        highlighted && styles.rankBadgeSelf,
      ]}
    >
      <Text style={[styles.rankText, onMetal ? styles.rankTextOnFill : null]}>{rank}</Text>
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
      <Icon name="info" size={ICON_SIZE} color={colors.accentDark} />
      <Text style={styles.noticeText}>{message}</Text>
      <Icon name="minus" size={ICON_SIZE} color={colors.textMuted} />
    </Pressable>
  );
}

function EmptyCard({
  icon,
  title,
  body,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
}): React.JSX.Element {
  return (
    <View style={styles.emptyCard}>
      <Icon name={icon} size={ICON_SIZE + 4} color={colors.textFaint} />
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
        <Icon name="alert" size={ICON_SIZE} color={colors.danger} />
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
  // The hero runs edge to edge, so only the content below it is inset.
  content: { paddingBottom: spacing.xxl },
  body: { padding: spacing.md, gap: spacing.md },

  seasonBanner: {
    ...cardStyle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  seasonText: { flex: 1, gap: 2 },
  seasonLabel: { ...type.caption, color: colors.textMuted },
  seasonName: { ...type.title, color: colors.text },
  seasonMeta: { ...type.caption, color: colors.textMuted },
  /** Gold is rank and reward; a soft tile so the emblem marks rather than shouts. */
  seasonEmblem: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  noticeText: { ...type.caption, color: colors.accentDark, flex: 1 },

  section: { gap: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.xs,
  },
  // Section headers sit on the page ground, above their group, not inside a card.
  sectionTitle: { ...type.heading, color: colors.text },
  sectionSubtitle: { ...type.caption, color: colors.textMuted },
  sectionBody: { gap: spacing.sm },

  inlineLoader: { marginTop: spacing.lg },

  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeSelf: {},
  rankText: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rankTextOnFill: { color: colors.textOnAccent },

  weeklyXpPill: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  weeklyXpValue: { ...type.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  weeklyXpUnit: { ...type.caption, color: colors.textFaint },

  emptyCard: { ...cardStyle, gap: spacing.xs, alignItems: 'flex-start' },
  emptyTitle: { ...type.heading, color: colors.text },
  emptyBody: { ...type.body, color: colors.textMuted },

  composer: { ...cardStyle, gap: spacing.md },
  composerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  composerTitle: { ...type.heading, color: colors.text },

  launchButton: { marginTop: spacing.sm },

  // The error takes a card of its own, so it reads as part of the content rather than
  // as text floating on the page ground.
  errorBlock: { ...cardStyle, gap: spacing.sm, alignItems: 'flex-start' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
});
