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
 * Visually it follows the app's light language: the habit list is a stack of bordered
 * cards that compress when pressed, and the running session is one card whose only
 * job is to hold the number. Every control comes from `Button`, so the press feel is
 * identical here and everywhere else.
 */

import { Ionicons } from '@expo/vector-icons';
import type { Category } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Pressable,
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
import { Button, cardStyle } from '../src/components/Button';
import { SessionReward } from '../src/components/SessionReward';
import { formatElapsed, TICK_MS, useTimerStore } from '../src/stores/timer';
import { colors, depth, radius, spacing, statColors, type } from '../src/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * A glyph per habit category.
 *
 * A habit row should be identifiable before it is read — scanning five icons is
 * faster than scanning five names — and a real icon set does that where a coloured
 * dot only ever carried the stat.
 */
const CATEGORY_ICONS: Readonly<Record<Category, IoniconName>> = {
  FITNESS: 'barbell',
  STUDY: 'book',
  MINDFULNESS: 'leaf',
  CREATIVE: 'color-palette',
  SOCIAL: 'chatbubbles',
  HEALTH: 'heart',
  SKILL: 'construct',
};

/** One size for a list row, one for the running session's header. */
const ICON_SIZE = 22;
const ICON_SIZE_LARGE = 24;
/** Inline icons that sit beside caption text. */
const ICON_SIZE_SMALL = 18;

/**
 * The habit's identity colour.
 *
 * Stat first, because a stat keeps one colour everywhere in the app; the habit's own
 * `colorHex` is the fallback for habits that train no stat.
 */
function habitAccent(habit: Habit): string {
  return habit.stat ? statColors[habit.stat] : habit.colorHex;
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

  const habits = habitsQuery.data?.habits ?? [];
  const activeSession = activeQuery.data?.session ?? null;
  const runningHabit = habits.find((habit) => habit.id === timer.habitId) ?? null;

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
          <Ionicons name="cloud-offline" size={ICON_SIZE_LARGE} color={colors.danger} />
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

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {isRunning ? (
        <View style={styles.runningPane}>
          <View style={styles.runningCard}>
            <View
              style={[
                styles.habitIcon,
                styles.habitIconLarge,
                { backgroundColor: runningHabit ? habitAccent(runningHabit) : colors.accent },
              ]}
            >
              <Ionicons
                name={runningHabit ? CATEGORY_ICONS[runningHabit.category] : 'flash'}
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
              <Ionicons
                name={undisturbed ? 'checkmark-circle' : 'alert-circle'}
                size={ICON_SIZE_SMALL}
                color={undisturbed ? colors.successDark : colors.warningDark}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: undisturbed ? colors.successDark : colors.warningDark },
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
      ) : (
        <View style={styles.idlePane}>
          <Text style={styles.title}>Bugün</Text>
          <Text style={styles.subtitle}>Bir alışkanlık seç ve başla.</Text>

          <Text style={styles.overline}>ALIŞKANLIKLARIN</Text>

          <FlatList
            data={habits}
            keyExtractor={(habit) => habit.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.stateBadge}>
                  <Ionicons name="add-circle" size={ICON_SIZE_LARGE} color={colors.accent} />
                </View>
                <Text style={styles.emptyText}>Henüz alışkanlık yok.</Text>
              </View>
            }
            renderItem={({ item }: { item: Habit }) => (
              // The slab under the card is this language's press signature: the face
              // slides down onto it, which reads as physical where a shadow would
              // simply disappear on a white ground.
              <Pressable
                style={[styles.habitSlab, busy && styles.inert]}
                disabled={busy}
                onPress={() => startMutation.mutate(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} seansı başlat`}
              >
                {({ pressed }) => (
                  <View style={[styles.habitFace, pressed && styles.habitFacePressed]}>
                    <View style={[styles.habitIcon, { backgroundColor: habitAccent(item) }]}>
                      <Ionicons
                        name={CATEGORY_ICONS[item.category]}
                        size={ICON_SIZE}
                        color={colors.textOnAccent}
                      />
                    </View>

                    <View style={styles.habitText}>
                      <Text style={styles.habitName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={styles.habitMetaRow}>
                        <Text style={styles.habitMeta}>{item.targetMinutes} dk</Text>
                        {item.currentStreak > 0 && (
                          <View style={styles.streakChip}>
                            <Ionicons
                              name="flame"
                              size={ICON_SIZE_SMALL}
                              color={colors.warningDark}
                            />
                            <Text style={styles.streakText}>{item.currentStreak} günlük seri</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    <Ionicons name="play-circle" size={ICON_SIZE_LARGE} color={colors.accent} />
                  </View>
                )}
              </Pressable>
            )}
          />
        </View>
      )}

      {error && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={ICON_SIZE_SMALL} color={colors.danger} />
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

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

/** Disc sizes. Big enough that the icon is the row's landmark, not a decoration. */
const HABIT_DISC = 44;
const SESSION_DISC = 56;
const TARGET_TRACK = 10;
/** A comfortable thumb target for the screen's primary action. */
const HABIT_ROW_HEIGHT = 76;

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

  idlePane: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, marginBottom: spacing.md },
  /** Section header: muted and wide-tracked, so it labels without competing. */
  overline: { ...type.overline, color: colors.textMuted, marginBottom: spacing.sm },
  overlineCentered: { ...type.overline, color: colors.textMuted, textAlign: 'center' },

  list: { gap: spacing.sm, paddingBottom: spacing.xl },

  empty: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
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

  habitSlab: {
    backgroundColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingBottom: depth.card,
  },
  habitFace: {
    ...cardStyle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: HABIT_ROW_HEIGHT,
  },
  habitFacePressed: {
    backgroundColor: colors.surfaceRaised,
    transform: [{ translateY: depth.card }],
  },
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
    backgroundColor: colors.warningSoft,
  },
  streakText: { ...type.caption, color: colors.warningDark },

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
  statusWarn: { backgroundColor: colors.warningSoft },
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
