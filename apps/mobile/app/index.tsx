/**
 * The timer screen.
 *
 * The spec's instruction for this phase was "one screen, but make it feel perfect",
 * because this is where the habit loop closes: cue, session, reward.
 *
 * Two behaviours worth knowing before reading:
 *
 *  1. Elapsed time is derived from the session's server-recorded `startedAt`, never
 *     accumulated locally. Backgrounding the app, locking the phone or losing the
 *     process does not lose time — on resume the screen simply renders the right
 *     number. The server recomputes the authoritative duration on completion anyway.
 *
 *  2. Leaving the foreground counts as an interruption, which feeds the focus
 *     quality multiplier. It is reported honestly rather than hidden, so the user can
 *     see why a distracted session scored lower.
 *
 * Visually it follows the parchment language: an illustrated hero heads the screen,
 * and below it a single "Bugün" sheet holds the day's habits as rows rather than as
 * a stack of separate cards. Grouping them matters — the card's header carries the
 * "3 / 5" progress for the day, which is the one number this screen exists to move,
 * and a row inside a sheet can state its own completion without becoming a card of
 * its own.
 */

import type { Category } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import {
  abandonSession,
  completeSession,
  getActiveSession,
  listHabits,
  startSession,
  type CompleteSessionResponse,
  type Habit,
} from '../src/api/sessions';
import {
  describeClass,
  getProfile,
  getProfileStats,
  readProfile,
  readStats,
} from '../src/api/profile';
import { getCurrentSeason, normaliseSeason } from '../src/api/social';
import { Button, cardStyle } from '../src/components/Button';
import { CharacterHeader } from '../src/components/CharacterHeader';
import { CATEGORY_ICONS, Icon, type IconName } from '../src/components/Icon';
import { ScreenHero } from '../src/components/ScreenHero';
import { SessionReward } from '../src/components/SessionReward';
import { formatElapsed, TICK_MS, useTimerStore } from '../src/stores/timer';
import { colors, radius, spacing, statColors, type } from '../src/theme';

/** One size for a list row, one for the running session's header. */
const ICON_SIZE = 22;
const ICON_SIZE_LARGE = 24;
/** Inline icons that sit beside caption text. */
const ICON_SIZE_SMALL = 18;

/**
 * The streak a habit row starts advertising at.
 *
 * Below a week the number is not yet something the user would cross the room to
 * protect, and printing it on every row turns the sheet into a wall of orange.
 */
const STREAK_CHIP_FLOOR = 7;

/**
 * The habit's identity colour.
 *
 * Stat first, because a stat keeps one colour everywhere in the app; the habit's own
 * `colorHex` is the fallback for habits that train no stat.
 */
function habitAccent(habit: Habit): string {
  return habit.stat ? statColors[habit.stat] : habit.colorHex;
}

/** The glyph for a habit's category, with a neutral fallback for unknown enums. */
function habitIcon(category: Category): IconName {
  return CATEGORY_ICONS[category] ?? 'play';
}

/** `YYYY-MM-DD` in the device's own timezone, which is what the API's dates mean. */
function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Idempotency key for one logical attempt.
 *
 * Kept stable across retries of the same action so a dropped response cannot award
 * XP twice — that is the contract the API's `clientRequestId` enforces.
 */
function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function TimerScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const timer = useTimerStore();
  const [reward, setReward] = useState<CompleteSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completeRequestId = useRef<string | null>(null);

  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const activeQuery = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession });
  const seasonQuery = useQuery({ queryKey: ['currentSeason'], queryFn: getCurrentSeason });
  /**
   * Shares the profile screen's cache key, so opening this screen after the profile
   * costs nothing and completing a session refreshes both from one invalidation.
   */
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  /**
   * The account streak, which lives on the stats endpoint rather than the profile.
   * A habit's own `streak` is per-habit and would report the best one, not the
   * account's — a user with one 14-day habit and four cold ones is not on day 14.
   */
  const statsQuery = useQuery({
    queryKey: ['profileStats', 'week' as const],
    queryFn: () => getProfileStats('week'),
  });

  const habits = habitsQuery.data?.habits ?? [];
  const activeSession = activeQuery.data?.session ?? null;
  const runningHabit = habits.find((habit) => habit.id === timer.habitId) ?? null;
  const season = useMemo(() => normaliseSeason(seasonQuery.data?.season), [seasonQuery.data]);

  const profile = useMemo(() => readProfile(profileQuery.data), [profileQuery.data]);
  const statsSummary = useMemo(() => readStats(statsQuery.data), [statsQuery.data]);
  /** Stat points are displayed as one total, the way the comp's third badge has it. */
  const statTotal = useMemo(() => {
    const sheet = profile?.stats;
    if (!sheet) return 0;
    return Object.values(sheet).reduce((sum, value) => sum + value, 0);
  }, [profile?.stats]);

  // Adopt whatever session the server says is running. This is what makes the timer
  // survive a reinstall or a second device.
  useEffect(() => {
    if (activeSession && activeSession.id !== timer.sessionId) {
      timer.start({
        sessionId: activeSession.id,
        habitId: activeSession.habitId,
        startedAt: activeSession.startedAt,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);

  // Repaint while a session runs. This interval does not measure anything; it only
  // asks the store to re-derive from the wall clock.
  useEffect(() => {
    if (!timer.sessionId) return;
    const id = setInterval(() => useTimerStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, [timer.sessionId]);

  // Count foreground exits as interruptions, and re-derive on return.
  useEffect(() => {
    const handler = (state: AppStateStatus): void => {
      if (!useTimerStore.getState().sessionId) return;
      if (state === 'active') useTimerStore.getState().tick();
      else if (state === 'background') useTimerStore.getState().recordInterruption();
    };
    const subscription = AppState.addEventListener('change', handler);
    return () => subscription.remove();
  }, []);

  const startMutation = useMutation({
    mutationFn: (habitId: string) => startSession({ habitId, clientRequestId: newRequestId() }),
    onSuccess: ({ session }) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      timer.start({ sessionId: session.id, habitId: session.habitId, startedAt: session.startedAt });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const completeMutation = useMutation({
    mutationFn: (sessionId: string) => {
      completeRequestId.current ??= newRequestId();
      return completeSession(sessionId, {
        clientRequestId: completeRequestId.current,
        interruptions: useTimerStore.getState().interruptions,
      });
    },
    onSuccess: (result) => {
      completeRequestId.current = null;
      timer.stop();
      setReward(result);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      // The banner above states the level, XP and streak the award just moved; without
      // this it would keep showing the old figures until the screen remounted.
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const abandonMutation = useMutation({
    mutationFn: (sessionId: string) => abandonSession(sessionId),
    onSuccess: () => {
      timer.stop();
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const dismissReward = useCallback(() => setReward(null), []);

  if (habitsQuery.isPending) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (habitsQuery.isError) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.stateBadge}>
          <Icon name="cloud-off" size={ICON_SIZE_LARGE} color={colors.danger} />
        </View>
        <Text style={styles.errorTitle}>Bağlanılamadı</Text>
        <Text style={styles.errorBody}>{describeError(habitsQuery.error)}</Text>
        <Button
          label="Tekrar dene"
          tone="neutral"
          size="small"
          block={false}
          onPress={() => void habitsQuery.refetch()}
          accessibilityLabel="Tekrar dene"
        />
      </SafeAreaView>
    );
  }

  const isRunning = timer.sessionId !== null;
  const busy = startMutation.isPending || completeMutation.isPending || abandonMutation.isPending;

  // Target progress is purely presentational: it reads the same elapsed seconds the
  // readout already shows, so it adds no state and no logic — it just stops the
  // running screen from being one number on an empty page.
  const targetSec = (runningHabit?.targetMinutes ?? 0) * 60;
  const targetRatio = targetSec > 0 ? Math.min(1, timer.elapsedSec / targetSec) : 0;
  const undisturbed = timer.interruptions === 0;

  const today = localDateKey(new Date());
  const doneToday = habits.filter((habit) => habit.lastCompletedDate === today).length;

  // A running session takes over the whole screen: there is exactly one thing to look
  // at, and the hero would only push the readout off a small handset.
  if (isRunning) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.runningPane}>
          <View style={styles.runningCard}>
            <View
              style={[
                styles.habitIcon,
                styles.habitIconLarge,
                { backgroundColor: runningHabit ? habitAccent(runningHabit) : colors.accent },
              ]}
            >
              <Icon
                name={runningHabit ? habitIcon(runningHabit.category) : 'xp-bolt-filled'}
                size={ICON_SIZE_LARGE}
                color={colors.textOnAccent}
              />
            </View>

            <Text style={styles.overlineCentered}>ODAK SEANSI</Text>

            {/*
              The habit name is not upper-cased in style any more: `textTransform`
              cases with the device locale, which turns a Turkish "i" into "I"
              instead of "İ". The overline above carries that job instead.
            */}
            <Text style={styles.runningHabit} numberOfLines={1}>
              {runningHabit?.name ?? 'Seans'}
            </Text>

            <Text style={styles.timer}>{formatElapsed(timer.elapsedSec)}</Text>

            {targetSec > 0 && (
              <View style={styles.targetBlock}>
                <View style={styles.targetTrack}>
                  <View
                    style={[
                      styles.targetFill,
                      { width: `${Math.round(targetRatio * 100)}%` },
                      targetRatio >= 1 && styles.targetFillDone,
                    ]}
                  />
                </View>
                <Text style={styles.targetLabel}>{runningHabit?.targetMinutes} dk hedef</Text>
              </View>
            )}

            <View style={[styles.statusChip, undisturbed ? styles.statusGood : styles.statusWarn]}>
              <Icon
                name={undisturbed ? 'check-circle-filled' : 'alert'}
                size={ICON_SIZE_SMALL}
                color={undisturbed ? colors.successDark : colors.fireDark}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: undisturbed ? colors.successDark : colors.fireDark },
                ]}
              >
                {undisturbed ? 'Kesintisiz — bonus kazanıyorsun' : `${timer.interruptions} kesinti`}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Button
              label={completeMutation.isPending ? 'Bitiriliyor…' : 'Bitir'}
              tone="primary"
              loading={completeMutation.isPending}
              disabled={busy}
              onPress={() => timer.sessionId && completeMutation.mutate(timer.sessionId)}
              accessibilityLabel="Seansı bitir"
            />

            <Button
              label="Vazgeç"
              tone="neutral"
              disabled={busy}
              onPress={() => timer.sessionId && abandonMutation.mutate(timer.sessionId)}
              accessibilityLabel="Seansı iptal et"
            />
          </View>
        </View>

        {error && (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Icon name="alert" size={ICON_SIZE_SMALL} color={colors.danger} />
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {reward && (
          <SessionReward
            result={reward}
            habitName={habits.find((habit) => habit.id === reward.session.habitId)?.name ?? 'Seans'}
            onDismiss={dismissReward}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      {/*
        A plain ScrollView rather than a FlatList: the hero has to scroll with the
        content, and the habit list is one sheet of a handful of rows — virtualising
        it would buy nothing and cost the grouped card its single background.
      */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/*
          The character leads this screen, because the app's claim is that habits
          build one — so the sheet below is the day's work on the figure above it,
          not a checklist that happens to sit under a picture.

          It degrades to the plain title rather than blocking: a profile request that
          fails or is still in flight must not keep the user from starting a session,
          which is the one thing this screen exists to do.
        */}
        {profile ? (
          <CharacterHeader
            image="today"
            name={profile.user.displayName?.trim() || profile.user.username}
            className={describeClass(profile.user.classType)}
            level={profile.progress.level}
            ratio={profile.progress.ratio}
            xpIntoLevel={profile.progress.xpIntoLevel}
            xpForNextLevel={profile.progress.isMaxLevel ? 0 : profile.progress.xpForNextLevel}
            streak={statsSummary?.currentStreak ?? 0}
            xp={profile.user.cycleXp}
            statPoints={statTotal}
            avatarUrl={profile.user.avatarUrl}
            prestige={profile.user.prestige}
          />
        ) : (
          <ScreenHero image="today" title="Bugün" subtitle="Bir alışkanlık seç ve başla." />
        )}

        <View style={styles.pane}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Bugün</Text>
              <Text
                style={styles.sheetCount}
                accessibilityLabel={`${habits.length} alışkanlıktan ${doneToday} tanesi tamamlandı`}
              >
                {doneToday} / {habits.length}
              </Text>
            </View>

            {habits.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.stateBadge}>
                  <Icon name="plus" size={ICON_SIZE_LARGE} color={colors.accent} />
                </View>
                <Text style={styles.emptyText}>Henüz alışkanlık yok.</Text>
              </View>
            ) : (
              habits.map((habit, index) => {
                const done = habit.lastCompletedDate === today;
                return (
                  <Pressable
                    key={habit.id}
                    style={[styles.habitRow, index > 0 && styles.habitRowDivided, busy && styles.inert]}
                    disabled={busy}
                    onPress={() => startMutation.mutate(habit.id)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, checked: done }}
                    accessibilityLabel={`${habit.name} seansı başlat${done ? '. Bugün tamamlandı.' : ''}`}
                  >
                    {({ pressed }) => (
                      <View style={[styles.habitRowInner, pressed && styles.habitRowPressed]}>
                        <View style={[styles.habitIcon, { backgroundColor: habitAccent(habit) }]}>
                          <Icon
                            name={habitIcon(habit.category)}
                            size={ICON_SIZE}
                            color={colors.textOnAccent}
                          />
                        </View>

                        <View style={styles.habitText}>
                          <Text style={styles.habitName} numberOfLines={1}>
                            {habit.name}
                          </Text>
                          <View style={styles.habitMetaRow}>
                            <Text style={styles.habitMeta}>{habit.targetMinutes} dk</Text>
                            {/*
                              The comp shows only the duration here, and it is right
                              that four streak chips in a column compete with the
                              banner's own streak badge. Kept for a streak worth
                              protecting, where it is the reason not to skip today.
                            */}
                            {habit.currentStreak >= STREAK_CHIP_FLOOR && (
                              <View style={styles.streakChip}>
                                <Icon
                                  name="flame-filled"
                                  size={ICON_SIZE_SMALL}
                                  color={colors.fireDark}
                                />
                                <Text style={styles.streakText}>
                                  {habit.currentStreak} günlük seri
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {/*
                          Completion is a state, not a control, so it reads as a mark
                          on the row rather than a second thing to press — the row
                          itself is the only pressable here.
                        */}
                        {done ? (
                          <Icon
                            name="check-circle-filled"
                            size={ICON_SIZE_LARGE}
                            color={colors.success}
                          />
                        ) : (
                          <Icon name="play-filled" size={ICON_SIZE_LARGE} color={colors.accent} />
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>

          {/*
            The season panel. Stone rather than parchment, because a season is the
            world speaking rather than the user's own record — and hidden entirely
            when there is no season, since an empty banner teaches nothing.
          */}
          {season !== null && (
            <View style={styles.seasonPanel}>
              <View style={styles.seasonDisc}>
                <Icon name="swords" size={ICON_SIZE} color={colors.gold} />
              </View>

              <View style={styles.seasonText}>
                <Text style={styles.seasonLabel}>AKTİF SEZON</Text>
                <Text style={styles.seasonName} numberOfLines={1}>
                  {season.name}
                </Text>
                <View style={styles.seasonBadgeRow}>
                  {season.theme !== null && (
                    <View style={styles.seasonChip}>
                      <Icon name="star-filled" size={ICON_SIZE_SMALL - 4} color={colors.gold} />
                      <Text style={styles.seasonChipText} numberOfLines={1}>
                        {season.theme}
                      </Text>
                    </View>
                  )}
                  {season.eventMultiplier !== null && (
                    <View style={[styles.seasonChip, styles.seasonChipXp]}>
                      <Icon
                        name="star-filled"
                        size={ICON_SIZE_SMALL - 4}
                        color={colors.textOnAccent}
                      />
                      <Text style={[styles.seasonChipText, styles.seasonChipTextXp]}>
                        ×{formatMultiplier(season.eventMultiplier)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Icon name="alert" size={ICON_SIZE_SMALL} color={colors.danger} />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {reward && (
        <SessionReward
          result={reward}
          habitName={habits.find((habit) => habit.id === reward.session.habitId)?.name ?? 'Seans'}
          onDismiss={dismissReward}
        />
      )}
    </View>
  );
}

/** "1.5" but "2" — a trailing ".0" on a multiplier reads as precision it does not have. */
function formatMultiplier(value: number): string {
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

/** Disc sizes. Big enough that the icon is the row's landmark, not a decoration. */
const HABIT_DISC = 44;
const SESSION_DISC = 56;
const SEASON_DISC = 44;
const TARGET_TRACK = 10;
/** A comfortable thumb target for the screen's primary action. */
const HABIT_ROW_HEIGHT = 64;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },

  scroll: { paddingBottom: spacing.xxl },
  /** Pulled up so the sheet overlaps the hero's rounded corner. */
  pane: { padding: spacing.md, gap: spacing.md, marginTop: -spacing.md },

  sheet: { ...cardStyle, paddingVertical: spacing.sm, gap: 0 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sheetTitle: { ...type.title, color: colors.text },
  sheetCount: { ...type.heading, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  /** Section header: muted and wide-tracked, so it labels without competing. */
  overlineCentered: { ...type.overline, color: colors.textMuted, textAlign: 'center' },

  empty: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  emptyText: { ...type.body, color: colors.textFaint, textAlign: 'center' },
  /** A tinted disc behind a state icon, so an empty or broken screen still has an anchor. */
  stateBadge: {
    width: HABIT_DISC,
    height: HABIT_DISC,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  habitRow: { borderRadius: radius.md },
  /** A hairline between rows, so the sheet reads as a list and not as one block. */
  habitRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  habitRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: HABIT_ROW_HEIGHT,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
  },
  habitRowPressed: { backgroundColor: colors.surfaceRaised },
  inert: { opacity: 0.5 },

  habitIcon: {
    width: HABIT_DISC,
    height: HABIT_DISC,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconLarge: { width: SESSION_DISC, height: SESSION_DISC },

  habitText: { flex: 1, gap: spacing.xs },
  habitName: { ...type.heading, color: colors.text },
  habitMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  habitMeta: { ...type.caption, color: colors.textMuted },

  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.fireSoft,
  },
  streakText: { ...type.caption, color: colors.fireDark },

  /** The one dark surface on this screen. Framed, so it reads as carved rather than flat. */
  seasonPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.stone,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.frame,
    padding: spacing.md,
  },
  seasonDisc: {
    width: SEASON_DISC,
    height: SEASON_DISC,
    borderRadius: radius.md,
    backgroundColor: colors.frame,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonText: { flex: 1, gap: 2 },
  seasonLabel: { ...type.overline, color: colors.textOnDarkMuted },
  seasonName: { ...type.heading, color: colors.textOnDark },
  seasonBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  seasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.frame,
  },
  seasonChipXp: { backgroundColor: colors.xp },
  seasonChipText: { ...type.caption, color: colors.textOnDarkMuted, flexShrink: 1 },
  seasonChipTextXp: { color: colors.textOnAccent },

  runningPane: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.lg },
  runningCard: {
    ...cardStyle,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  runningHabit: { ...type.heading, color: colors.text },
  timer: { ...type.timer, color: colors.text },

  targetBlock: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.sm },
  targetTrack: {
    height: TARGET_TRACK,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  targetFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  /** Green is reserved for "done", which is exactly what a met target is. */
  targetFillDone: { backgroundColor: colors.success },
  targetLabel: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  statusGood: { backgroundColor: colors.successSoft },
  statusWarn: { backgroundColor: colors.fireSoft },
  statusText: { ...type.caption },

  actions: { gap: spacing.sm },

  errorTitle: { ...type.heading, color: colors.text },
  errorBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorBannerText: { ...type.caption, color: colors.danger, flexShrink: 1 },
});
