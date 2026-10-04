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
 * Visually: an illustrated hero heads the screen, and below it the day's habits sit
 * as rows in one grouped card rather than a stack of separate cards. The section
 * header above it carries the "3 / 5" progress for the day, which is the one number
 * this screen exists to move, and a row can state its own completion without
 * becoming a card of its own.
 */

import { projectedSessionDamage, resolveStat, type Category } from '@habitwar/domain';
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
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeOutDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getBestiary, type Hunt } from '../../src/api/monsters';
import { ApiError } from '../../src/api/client';
import {
  abandonSession,
  completeSession,
  deleteHabit,
  getActiveSession,
  listHabits,
  logCount,
  pauseSession,
  resumeSession,
  startSession,
  type CompleteSessionResponse,
  type Habit,
} from '../../src/api/sessions';
import {
  describeClass,
  getProfile,
  getProfileStats,
  readProfile,
  readStats,
} from '../../src/api/profile';
import {
  checkInChallenge,
  getCurrentSeason,
  listChallenges,
  normaliseChallenges,
  normaliseSeason,
} from '../../src/api/social';
import { Button, cardStyle, ChipButton } from '../../src/components/Button';
import { CharacterHeader } from '../../src/components/CharacterHeader';
import { monsterIcon } from '../../src/components/monsterArt';
import { Group } from '../../src/components/Group';
import { NewHabitSheet } from '../../src/components/NewHabitSheet';
import { stepFor } from '../../src/countUnits';
import { FEATURES } from '../../src/features';
import { CATEGORY_ICONS, Icon, type IconName } from '../../src/components/Icon';
import { ScreenHero } from '../../src/components/ScreenHero';
import { SessionReward } from '../../src/components/SessionReward';
import { formatElapsed, TICK_MS, useTimerStore } from '../../src/stores/timer';
import { categoryLabels, colors, hairline, radius, spacing, statColors, type } from '../../src/theme';

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
  const [adding, setAdding] = useState(false);
  const [addCategory, setAddCategory] = useState<Category | null>(null);
  /** The list's edit mode, as in a system list: rows stop starting sessions and offer removal. */
  const [editing, setEditing] = useState(false);
  /** The row whose removal is armed. A second tap on its "Sil" confirms. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // A duel with no habit in its category sends the user here with `?add=<category>`
  // (and an `at` stamp that makes each request distinct): open the form with that
  // category chosen, then drop the params so a later visit does not reopen it.
  const params = useLocalSearchParams<{ add?: string; at?: string }>();
  useEffect(() => {
    const requested = params.add;
    if (!requested || (requested !== 'any' && !(requested in categoryLabels))) return;
    // 'any' opens the catalog with no group in front.
    setAddCategory(requested === 'any' ? null : (requested as Category));
    setAdding(true);
    setEditing(false);
    router.setParams({ add: undefined, at: undefined });
  }, [params.add, params.at]);
  const completeRequestId = useRef<string | null>(null);

  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const activeQuery = useQuery({ queryKey: ['activeSession'], queryFn: getActiveSession });
  const seasonQuery = useQuery({ queryKey: ['currentSeason'], queryFn: getCurrentSeason });
  /** Running duels, so a habit whose sessions score in one can say so on its row. */
  // Not fetched at all while duels are switched off: no duel tag, no duel section.
  const challengesQuery = useQuery({
    queryKey: ['challenges'],
    queryFn: listChallenges,
    enabled: FEATURES.duels,
  });
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
  /** The title the player wears: their latest monster beaten. Shares the battle tab's cache. */
  const bestiaryQuery = useQuery({ queryKey: ['monsters'], queryFn: getBestiary });
  const bossTitle = bestiaryQuery.data?.trophies[0]?.title ?? null;
  /** The monster a running session is hitting, if the player is hunting one. */
  const activeHunt = bestiaryQuery.data?.active ?? null;
  const activeDuels = useMemo(() => {
    const payload = challengesQuery.data;
    const all = normaliseChallenges([...(payload?.active ?? []), ...(payload?.challenges ?? [])]);
    return all.filter((duel) => duel.status === 'ACTIVE');
  }, [challengesQuery.data]);
  /** Legacy XP duels score a category's sessions; their habits say so on the row. */
  const duelCategories = useMemo(
    () => new Set(activeDuels.filter((duel) => duel.task === null).map((duel) => duel.category)),
    [activeDuels],
  );
  /** Task duels running today: checked in from here, one tap, where the day starts. */
  const taskDuels = useMemo(
    () => activeDuels.filter((duel) => duel.task !== null && duel.currentDay !== null),
    [activeDuels],
  );
  const viewerId = profile?.user.id ?? null;

  const checkInMutation = useMutation({
    mutationFn: (challengeId: string) => checkInChallenge(challengeId),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const statsSummary = useMemo(() => readStats(statsQuery.data), [statsQuery.data]);
  /** Stat points are displayed as one total, the way the comp's third badge has it. */
  const statTotal = useMemo(() => {
    const sheet = profile?.stats;
    if (!sheet) return 0;
    return Object.values(sheet).reduce((sum, value) => sum + value, 0);
  }, [profile?.stats]);

  // Adopt whatever session the server says is running, pause state included. This is
  // what makes the timer survive a reinstall or a second device — and a session paused
  // before the app was closed reopen paused, at the second it stopped.
  useEffect(() => {
    if (activeSession) {
      timer.start({
        sessionId: activeSession.id,
        habitId: activeSession.habitId,
        startedAt: activeSession.startedAt,
        pausedSec: activeSession.pausedSec,
        pausedAt: activeSession.pausedAt,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.pausedAt, activeSession?.pausedSec]);

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
      // Leaving a paused session is not an interruption: the pause already counted.
      else if (state === 'background' && useTimerStore.getState().pausedAtMs === null) {
        useTimerStore.getState().recordInterruption();
      }
    };
    const subscription = AppState.addEventListener('change', handler);
    return () => subscription.remove();
  }, []);

  const startMutation = useMutation({
    mutationFn: (habitId: string) => startSession({ habitId, clientRequestId: newRequestId() }),
    onSuccess: ({ session }) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      timer.start({
        sessionId: session.id,
        habitId: session.habitId,
        startedAt: session.startedAt,
        pausedSec: session.pausedSec,
        pausedAt: session.pausedAt,
      });
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
      // The session just hit the hunted monster.
      void queryClient.invalidateQueries({ queryKey: ['monsters'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  /**
   * A count habit's quick log. A felled monster gets the full reward screen — that is
   * the moment worth stopping for; an ordinary tap gets a two-second toast, so tapping
   * "+10" again is never more than a second away.
   */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  const logMutation = useMutation({
    mutationFn: (input: { habit: Habit; count: number }) =>
      logCount(input.habit.id, { count: input.count, clientRequestId: newRequestId() }),
    onSuccess: (result, input) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setError(null);
      const unit = input.habit.unit ?? '';
      if (result.monster?.defeated) {
        setReward(result);
      } else if (result.monster) {
        showToast(`+${input.count} ${unit} · ${result.monster.name} −${result.monster.damage} can`);
      } else {
        showToast(`+${input.count} ${unit}${result.xp > 0 ? ` · +${result.xp} XP` : ''}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      void queryClient.invalidateQueries({ queryKey: ['monsters'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (habitId: string) => deleteHabit(habitId),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingDelete(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  /** Pause and resume: the server records both, and its answer is adopted as is. */
  const pauseMutation = useMutation({
    mutationFn: (input: { sessionId: string; pause: boolean }) =>
      input.pause ? pauseSession(input.sessionId) : resumeSession(input.sessionId),
    onSuccess: ({ session }) => {
      void Haptics.selectionAsync();
      timer.start({
        sessionId: session.id,
        habitId: session.habitId,
        startedAt: session.startedAt,
        pausedSec: session.pausedSec,
        pausedAt: session.pausedAt,
      });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
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
  const busy =
    startMutation.isPending ||
    completeMutation.isPending ||
    abandonMutation.isPending ||
    deleteMutation.isPending ||
    pauseMutation.isPending;

  // Target progress is purely presentational: it reads the same elapsed seconds the
  // readout already shows, so it adds no state and no logic — it just stops the
  // running screen from being one number on an empty page.
  const targetSec = (runningHabit?.targetMinutes ?? 0) * 60;
  const targetRatio = targetSec > 0 ? Math.min(1, timer.elapsedSec / targetSec) : 0;
  const isPaused = timer.pausedAtMs !== null;
  // Pauses count as interruptions on the server; the readout says so before it does.
  const undisturbed = timer.interruptions === 0 && !isPaused && (activeSession?.pauseCount ?? 0) === 0;

  const today = localDateKey(new Date());
  const doneToday = habits.filter((habit) =>
    habit.kind === 'COUNT'
      ? (habit.todayCount ?? 0) >= (habit.targetCount ?? 1)
      : habit.lastCompletedDate === today,
  ).length;

  // A running session takes over the whole screen: there is exactly one thing to look
  // at, and the hero would only push the readout off a small handset.
  if (isRunning) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.runningPane}>
          {/*
            The fight. The monster's HP drains as the minutes run — an estimate from
            elapsed time, the category and focus, since the real hit is only known when
            the server scores the session. Paused, it freezes with the clock.
          */}
          {activeHunt !== null && runningHabit !== null && (
            <FightPanel
              hunt={activeHunt}
              projected={projectedSessionDamage({
                elapsedSec: timer.elapsedSec,
                category: runningHabit.category,
                stat: resolveStat(runningHabit.category, runningHabit.stat),
                interruptions: timer.interruptions + (activeSession?.pauseCount ?? 0),
                weakness: activeHunt.monster.weakness,
              })}
              weak={resolveStat(runningHabit.category, runningHabit.stat) === activeHunt.monster.weakness}
              elapsedSec={timer.elapsedSec}
              interruptions={timer.interruptions}
              paused={isPaused}
            />
          )}

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

            <Text style={styles.overlineCentered}>Odak seansı</Text>

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

            {isPaused ? (
              <View style={[styles.statusChip, styles.statusPaused]}>
                <Icon name="clock" size={ICON_SIZE_SMALL} color={colors.textMuted} />
                <Text style={[styles.statusText, { color: colors.textMuted }]}>
                  Duraklatıldı — süre işlemiyor
                </Text>
              </View>
            ) : (
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
                  {undisturbed ? 'Kesintisiz — bonus kazanıyorsun' : 'Kesinti oldu — bonus yok'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actions}>
            {/* Pause leads when running, resume when paused: the next thing to do. */}
            <Button
              label={isPaused ? 'Devam et' : 'Duraklat'}
              tone={isPaused ? 'primary' : 'neutral'}
              loading={pauseMutation.isPending}
              disabled={busy}
              onPress={() =>
                timer.sessionId && pauseMutation.mutate({ sessionId: timer.sessionId, pause: !isPaused })
              }
              accessibilityLabel={isPaused ? 'Seansa devam et' : 'Seansı duraklat'}
            />

            <Button
              label={completeMutation.isPending ? 'Bitiriliyor…' : 'Bitir'}
              tone="primary"
              loading={completeMutation.isPending}
              disabled={busy}
              onPress={() => timer.sessionId && completeMutation.mutate(timer.sessionId)}
              accessibilityLabel="Seansı bitir"
            />

            {/* Quiet, last: throwing a session away is never the main thing. */}
            <Pressable
              disabled={busy}
              onPress={() => timer.sessionId && abandonMutation.mutate(timer.sessionId)}
              accessibilityRole="button"
              accessibilityLabel="Seansı iptal et"
              style={({ pressed }) => [styles.abandon, pressed && styles.inert]}
            >
              <Text style={styles.abandonText}>Vazgeç</Text>
            </Pressable>
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
            className={
              bossTitle !== null
                ? `${describeClass(profile.user.classType)} · ${bossTitle}`
                : describeClass(profile.user.classType)
            }
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
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Bugün</Text>
            <View style={styles.sectionTrailing}>
              {habits.length > 0 && (
                <Text
                  style={styles.sectionCount}
                  accessibilityLabel={`${habits.length} alışkanlıktan ${doneToday} tanesi tamamlandı`}
                >
                  {doneToday} / {habits.length}
                </Text>
              )}
              {habits.length > 0 && !adding && (
                <Pressable
                  onPress={() => {
                    setEditing((value) => !value);
                    setPendingDelete(null);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? 'Düzenlemeyi bitir' : 'Alışkanlıkları düzenle'}
                  style={({ pressed }) => pressed && styles.inert}
                >
                  <Text style={[styles.headerAction, editing && styles.headerActionDone]}>
                    {editing ? 'Bitti' : 'Düzenle'}
                  </Text>
                </Pressable>
              )}
              {/* Hidden while the form is open: it is already the thing this opens. */}
              {!adding && !editing && habits.length > 0 && (
                <Pressable
                  onPress={() => setAdding(true)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Yeni alışkanlık ekle"
                  style={({ pressed }) => [styles.addButton, pressed && styles.inert]}
                >
                  <Icon name="plus" size={ICON_SIZE_SMALL} color={colors.accent} />
                </Pressable>
              )}
            </View>
          </View>

          {adding && (
            <NewHabitSheet
              initialCategory={addCategory}
              onClose={() => {
                setAdding(false);
                setAddCategory(null);
              }}
            />
          )}

          {habits.length === 0 && adding ? null : (
          <View style={styles.sheet}>
            {habits.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Henüz alışkanlık yok</Text>
                <Text style={styles.emptyText}>
                  İlk alışkanlığını ekle, sonra ona dokunarak bir seans başlat.
                </Text>
                <Button
                  label="Alışkanlık ekle"
                  size="small"
                  block={false}
                  onPress={() => setAdding(true)}
                  accessibilityLabel="İlk alışkanlığını ekle"
                />
              </View>
            ) : (
              habits.map((habit, index) => {
                // A count habit is done when today's count reaches its target; a timed one
                // when a session completed today.
                const counted = habit.kind === 'COUNT' && (habit.targetCount ?? 0) > 0;
                const target = habit.targetCount ?? 0;
                const countToday = habit.todayCount ?? 0;
                const done = counted ? countToday >= target : habit.lastCompletedDate === today;
                const step = stepFor(habit.unit, target);
                const row = (pressed: boolean): React.JSX.Element => (
                  <View style={[styles.habitRowInner, pressed && styles.habitRowPressed]}>
                    <View style={[styles.habitIcon, { backgroundColor: habitAccent(habit) }]}>
                      <Icon
                        name={habitIcon(habit.category)}
                        size={ICON_SIZE}
                        color={colors.textOnAccent}
                      />
                    </View>

                    <View style={[styles.habitText, index > 0 && styles.habitTextDivided]}>
                      <Text style={styles.habitName} numberOfLines={1}>
                        {habit.name}
                      </Text>
                      <View style={styles.habitMetaRow}>
                        <Text style={styles.habitMeta}>
                          {counted
                            ? `${countToday} / ${target} ${habit.unit ?? ''}`
                            : `${habit.targetMinutes} dk`}
                        </Text>
                        {/*
                          The comp shows only the duration here, and it is right
                          that four streak chips in a column compete with the
                          banner's own streak badge. Kept for a streak worth
                          protecting, where it is the reason not to skip today.
                        */}
                        {habit.currentStreak >= STREAK_CHIP_FLOOR && (
                          <>
                            <Icon
                              name="flame-filled"
                              size={ICON_SIZE_SMALL - 4}
                              color={colors.fire}
                            />
                            <Text style={styles.streakText}>{habit.currentStreak} gün</Text>
                          </>
                        )}
                        {/* Says where this habit's sessions also land: the duel. */}
                        {duelCategories.has(habit.category) && (
                          <>
                            <Icon name="swords" size={ICON_SIZE_SMALL - 4} color={colors.accent} />
                            <Text style={styles.duelTag}>Düello</Text>
                          </>
                        )}
                      </View>
                    </View>

                    {/*
                      Completion is a state, not a control, so it reads as a mark
                      on the row rather than a second thing to press — the row
                      itself is the only pressable here.
                    */}
                    <View style={[styles.habitTrailing, index > 0 && styles.habitTextDivided]}>
                      {editing ? (
                        pendingDelete === habit.id ? (
                          <ChipButton
                            label="Sil"
                            tone="danger"
                            disabled={busy}
                            onPress={() => deleteMutation.mutate(habit.id)}
                            accessibilityLabel={`${habit.name} alışkanlığını sil`}
                          />
                        ) : (
                          <Pressable
                            onPress={() => setPendingDelete(habit.id)}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={`${habit.name} alışkanlığını silmeye hazırla`}
                          >
                            <View style={styles.removeDisc}>
                              <Icon name="minus" size={ICON_SIZE_SMALL - 4} color={colors.textOnAccent} />
                            </View>
                          </Pressable>
                        )
                      ) : counted ? (
                        // A count habit's action is the tap itself: one quick blow. Past
                        // the target it keeps its check and stops asking.
                        done ? (
                          <Icon name="check-circle-filled" size={ICON_SIZE_LARGE} color={colors.success} />
                        ) : (
                          <ChipButton
                            label={`+${step}`}
                            tone="primary"
                            disabled={busy || logMutation.isPending}
                            onPress={() => logMutation.mutate({ habit, count: step })}
                            accessibilityLabel={`${habit.name}: ${step} ${habit.unit ?? ''} ekle`}
                          />
                        )
                      ) : done ? (
                        // Done today: the mark, and a separate, explicit way to go again.
                        <View style={styles.doneTrailing}>
                          <Icon
                            name="check-circle-filled"
                            size={ICON_SIZE_LARGE}
                            color={colors.success}
                          />
                          <ChipButton
                            label="Tekrar"
                            tone="neutral"
                            disabled={busy}
                            onPress={() => startMutation.mutate(habit.id)}
                            accessibilityLabel={`${habit.name} seansını yeniden başlat`}
                          />
                        </View>
                      ) : (
                        <Icon name="play-filled" size={ICON_SIZE_LARGE} color={colors.accent} />
                      )}
                    </View>
                  </View>
                );

                // In edit mode, and once done today, the row is a plain view rather than a
                // start button. Editing: a stray tap must not begin a session. Done: a
                // finished habit does not restart on a tap meant to look at it — going
                // again is its own button. In both, the row's controls must not sit
                // inside another button.
                if (editing || done || counted) {
                  return (
                    <View key={habit.id} style={[styles.habitRow, busy && styles.inert]}>
                      {row(false)}
                    </View>
                  );
                }

                return (
                  <Pressable
                    key={habit.id}
                    style={[styles.habitRow, busy && styles.inert]}
                    disabled={busy}
                    onPress={() => startMutation.mutate(habit.id)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, checked: done }}
                    accessibilityLabel={`${habit.name} seansı başlat${done ? '. Bugün tamamlandı.' : ''}`}
                  >
                    {({ pressed }) => row(pressed)}
                  </Pressable>
                );
              })
            )}
          </View>
          )}

          {/*
            Today's duel tasks. A task duel is won by showing up daily, so its check-in
            sits on the screen the day starts on, beside the habits — not two taps away
            on the battle tab.
          */}
          {taskDuels.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Düello görevleri</Text>
              </View>
              <Group inset={spacing.md + 36 + spacing.md}>
                {taskDuels.map((duel) => {
                  const mineIsChallenger = viewerId === null || duel.challenger.id === viewerId;
                  const me = mineIsChallenger ? duel.challenger : duel.opponent;
                  const rival = mineIsChallenger ? duel.opponent : duel.challenger;
                  const myScore = mineIsChallenger ? duel.challengerXp : duel.opponentXp;
                  const rivalScore = mineIsChallenger ? duel.opponentXp : duel.challengerXp;
                  const done = duel.checkIns.some(
                    (row) => row.userId === me.id && row.day === duel.currentDay,
                  );
                  return (
                    <View key={duel.id} style={styles.duelRow}>
                      <View style={styles.duelIcon}>
                        <Icon name="swords" size={ICON_SIZE_SMALL} color={colors.accent} />
                      </View>
                      <View style={styles.duelText}>
                        <Text style={styles.habitName} numberOfLines={1}>
                          {duel.task}
                        </Text>
                        <Text style={styles.habitMeta} numberOfLines={1}>
                          {rival.displayName} ile · {duel.currentDay}. gün / {duel.days} · {myScore}–{rivalScore}
                        </Text>
                      </View>
                      {done ? (
                        <Icon name="check-circle-filled" size={ICON_SIZE_LARGE} color={colors.success} />
                      ) : (
                        <ChipButton
                          label="Yaptım"
                          tone="primary"
                          disabled={checkInMutation.isPending}
                          onPress={() => checkInMutation.mutate(duel.id)}
                          accessibilityLabel={`${duel.task ?? 'Görev'} bugün yapıldı olarak işaretle`}
                        />
                      )}
                    </View>
                  );
                })}
              </Group>
              <View style={styles.sectionSpacer} />
            </>
          )}

          {/*
            The season, as one quiet row — hidden entirely when there is no season,
            since an empty banner teaches nothing. Theme and multiplier are one line of
            text rather than chips: they are facts to read, not things to press.
          */}
          {season !== null && (
            <View style={styles.seasonPanel}>
              <View style={styles.seasonDisc}>
                <Icon name="swords" size={ICON_SIZE} color={colors.goldDark} />
              </View>

              <View style={styles.seasonText}>
                <Text style={styles.seasonLabel}>Aktif sezon</Text>
                <Text style={styles.seasonName} numberOfLines={1}>
                  {season.name}
                </Text>
                {(season.theme !== null || season.eventMultiplier !== null) && (
                  <Text style={styles.seasonMeta} numberOfLines={1}>
                    {[
                      season.theme,
                      season.eventMultiplier !== null
                        ? `×${formatMultiplier(season.eventMultiplier)} XP`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
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

      {toast !== null && (
        <Animated.View
          entering={FadeInDown.duration(160)}
          exiting={FadeOutDown.duration(160)}
          style={styles.toast}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
        >
          <Icon name="swords" size={ICON_SIZE_SMALL} color={colors.textOnDark} />
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
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

/** Minutes between critical hits: 15, 30, 45… */
const CRIT_EVERY_MINUTES = 15;

interface HitPop {
  readonly id: number;
  readonly value: number;
  readonly crit: boolean;
}

/**
 * The hunted monster on the timer screen, its HP draining with the session.
 *
 * A long session must not feel like waiting, so the fight is paced in blows: every
 * minute lands a visible hit — the emblem shakes, the damage floats up, the phone taps
 * — and every fifteenth is a critical. Minutes in a row without leaving the app build
 * a combo; leaving breaks it (the monster's counter-attack). All of this is show: the
 * damage is the same estimate as the bar, and the real hit is scored on completion.
 */
function FightPanel({
  hunt,
  projected,
  weak,
  elapsedSec,
  interruptions,
  paused,
}: {
  readonly hunt: Hunt;
  readonly projected: number;
  readonly weak: boolean;
  readonly elapsedSec: number;
  readonly interruptions: number;
  readonly paused: boolean;
}): React.JSX.Element {
  const minute = Math.floor(elapsedSec / 60);
  const [pops, setPops] = useState<readonly HitPop[]>([]);
  const [counterAttack, setCounterAttack] = useState(false);
  const lastMinute = useRef(minute);
  const lastProjected = useRef(projected);
  const comboFrom = useRef(minute);
  const lastInterruptions = useRef(interruptions);
  const popId = useRef(0);
  const shake = useSharedValue(0);

  // A minute landed: one blow, or a critical on the quarter hour.
  useEffect(() => {
    if (minute <= lastMinute.current) {
      lastMinute.current = minute;
      lastProjected.current = projected;
      return;
    }
    const value = Math.max(0, projected - lastProjected.current);
    const crit = minute % CRIT_EVERY_MINUTES === 0;
    lastMinute.current = minute;
    lastProjected.current = projected;
    if (value <= 0) return;

    popId.current += 1;
    const pop = { id: popId.current, value, crit };
    setPops((current) => [...current.slice(-2), pop]);
    setTimeout(() => setPops((current) => current.filter((item) => item.id !== pop.id)), 1400);

    const amplitude = crit ? 7 : 4;
    shake.value = withSequence(
      withTiming(-amplitude, { duration: 50 }),
      withTiming(amplitude, { duration: 50 }),
      withTiming(-amplitude / 2, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
    if (crit) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // `shake` is a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute]);

  // Leaving the app is the monster's opening: the combo breaks.
  useEffect(() => {
    if (interruptions > lastInterruptions.current) {
      comboFrom.current = minute;
      setCounterAttack(true);
      const id = setTimeout(() => setCounterAttack(false), 2500);
      lastInterruptions.current = interruptions;
      return () => clearTimeout(id);
    }
    lastInterruptions.current = interruptions;
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interruptions]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const hpLeft = Math.max(0, hunt.hp - projected);
  const ratio = hunt.maxHp > 0 ? hpLeft / hunt.maxHp : 0;
  const felled = hpLeft === 0;
  const combo = minute - comboFrom.current;
  const nextCrit = CRIT_EVERY_MINUTES - (minute % CRIT_EVERY_MINUTES);

  return (
    <View
      style={styles.fight}
      accessible
      accessibilityLabel={`${hunt.name}: yaklaşık ${hpLeft} / ${hunt.maxHp} can. Bu seans yaklaşık ${projected} hasar.`}
    >
      <Animated.View style={[styles.fightEmblem, hunt.isBoss && styles.fightEmblemBoss, shakeStyle]}>
        <Icon name={monsterIcon(hunt.monster.key)} size={22} color={hunt.isBoss ? colors.gold : colors.textOnDark} />
        {pops.map((pop) => (
          <Animated.Text
            key={pop.id}
            entering={FadeInDown.duration(180)}
            exiting={FadeOutUp.duration(500)}
            style={[styles.pop, pop.crit && styles.popCrit]}
          >
            {pop.crit ? `KRİTİK −${pop.value}` : `−${pop.value}`}
          </Animated.Text>
        ))}
      </Animated.View>
      <View style={styles.fightBody}>
        <View style={styles.fightTop}>
          <Text style={styles.fightName} numberOfLines={1}>
            {hunt.isBoss ? 'BOSS · ' : ''}
            {hunt.name}
          </Text>
          <Text style={styles.fightHp}>
            ~{hpLeft}/{hunt.maxHp}
          </Text>
        </View>
        <View style={styles.fightTrack}>
          <View style={[styles.fightFill, { width: `${Math.round(ratio * 100)}%` }]} />
        </View>
        <Text style={[styles.fightMeta, counterAttack && styles.fightMetaAlert]}>
          {counterAttack
            ? `${hunt.name} karşı saldırdı! Kombo bozuldu.`
            : felled
              ? 'Bitir de — bu seans onu deviriyor!'
              : paused
                ? 'Duraklatıldı — canavar bekliyor.'
                : `~${projected} hasar${weak ? ' · zayıf nokta ×1.5' : ''}${
                    combo >= 2 ? ` · ×${combo} kombo` : ''
                  } · kritik vuruşa ${nextCrit} dk`}
        </Text>
      </View>
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
const HABIT_DISC = 36;
const SESSION_DISC = 56;
const SEASON_DISC = 44;
const TARGET_TRACK = 6;
/** A comfortable thumb target for the screen's primary action. */
const HABIT_ROW_HEIGHT = 60;

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
  pane: { padding: spacing.md, gap: spacing.sm },

  /** Section header above a grouped card, the way iOS labels a group. */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  sectionTitle: { ...type.title, color: colors.text },
  sectionTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionCount: { ...type.heading, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  headerAction: { ...type.label, color: colors.accent },
  headerActionDone: { fontFamily: 'Nunito_800ExtraBold' },
  /** The red minus of a system list in edit mode. */
  removeDisc: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** A tinted round "+", like the add control in a system list header. */
  addButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheet: { ...cardStyle, paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden', marginBottom: spacing.md },

  /** Section header: muted and wide-tracked, so it labels without competing. */
  overlineCentered: { ...type.label, color: colors.textMuted, textAlign: 'center' },

  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { ...type.heading, color: colors.text, textAlign: 'center' },
  emptyText: { ...type.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xs },
  /** A tinted disc behind a state icon, so an empty or broken screen still has an anchor. */
  stateBadge: {
    width: HABIT_DISC,
    height: HABIT_DISC,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  habitRow: {},
  habitRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
  },
  habitRowPressed: { backgroundColor: colors.surfaceRaised },
  inert: { opacity: 0.5 },

  /** A rounded square, like an app icon: the category's colour is identity, so it stays. */
  habitIcon: {
    width: HABIT_DISC,
    height: HABIT_DISC,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconLarge: { width: SESSION_DISC, height: SESSION_DISC, borderRadius: radius.md + 2 },

  habitText: {
    flex: 1,
    gap: 2,
    minHeight: HABIT_ROW_HEIGHT,
    justifyContent: 'center',
  },
  /**
   * The separator is drawn on the text column and the trailing mark, not the row, so
   * it starts after the icon — an inset hairline, as in every iOS list.
   */
  habitTextDivided: { borderTopWidth: hairline, borderTopColor: colors.border },
  habitTrailing: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingRight: spacing.md,
    paddingLeft: spacing.sm,
    marginLeft: -spacing.md,
  },
  habitName: { ...type.heading, color: colors.text },
  habitMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  habitMeta: { ...type.caption, color: colors.textMuted },
  streakText: { ...type.caption, color: colors.fireDark },
  duelText: { flex: 1, gap: 2 },
  duelTag: { ...type.caption, color: colors.accent },
  duelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  duelIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionSpacer: { height: spacing.sm },

  seasonPanel: {
    ...cardStyle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  /** Gold is rank and reward, which a season is; soft so it marks rather than shouts. */
  seasonDisc: {
    width: SEASON_DISC,
    height: SEASON_DISC,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonText: { flex: 1, gap: 2 },
  seasonLabel: { ...type.caption, color: colors.textMuted },
  seasonName: { ...type.heading, color: colors.text },
  seasonMeta: { ...type.caption, color: colors.textMuted },

  runningPane: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.lg },

  fight: {
    ...cardStyle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fightEmblem: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.stone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fightEmblemBoss: { borderWidth: 2, borderColor: colors.gold },
  fightBody: { flex: 1, gap: spacing.xs },
  fightTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  fightName: { ...type.heading, color: colors.text, flexShrink: 1 },
  fightHp: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  fightTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fightFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  fightMeta: { ...type.caption, color: colors.textMuted },
  fightMetaAlert: { color: colors.danger, fontFamily: 'Nunito_800ExtraBold' },
  // Floats off the emblem: the minute's blow.
  pop: {
    position: 'absolute',
    top: -18,
    alignSelf: 'center',
    ...type.label,
    color: colors.danger,
  },
  popCrit: { color: colors.goldDark, fontFamily: 'Nunito_800ExtraBold', top: -22 },
  runningCard: {
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
  statusPaused: { backgroundColor: colors.surfaceRaised },
  abandon: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  abandonText: { ...type.label, color: colors.danger },
  doneTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.stone,
  },
  toastText: { ...type.label, color: colors.textOnDark, flex: 1 },
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
