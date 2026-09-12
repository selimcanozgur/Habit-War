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
 */

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
import { SessionReward } from '../src/components/SessionReward';
import { formatElapsed, TICK_MS, useTimerStore } from '../src/stores/timer';
import { colors, radius, spacing, statColors, type } from '../src/theme';

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
        <Text style={styles.errorTitle}>Bağlanılamadı</Text>
        <Text style={styles.errorBody}>{describeError(habitsQuery.error)}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void habitsQuery.refetch()}>
          <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isRunning = timer.sessionId !== null;
  const busy = startMutation.isPending || completeMutation.isPending || abandonMutation.isPending;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {isRunning ? (
        <View style={styles.runningPane}>
          <Text style={styles.runningHabit}>{runningHabit?.name ?? 'Seans'}</Text>

          <Text style={styles.timer}>{formatElapsed(timer.elapsedSec)}</Text>

          <Text style={styles.runningMeta}>
            {timer.interruptions === 0
              ? 'Kesintisiz — bonus kazanıyorsun'
              : `${timer.interruptions} kesinti`}
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={() => timer.sessionId && completeMutation.mutate(timer.sessionId)}
              accessibilityRole="button"
              accessibilityLabel="Seansı bitir"
            >
              <Text style={styles.primaryButtonText}>
                {completeMutation.isPending ? 'Bitiriliyor…' : 'Bitir'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.ghostButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={() => timer.sessionId && abandonMutation.mutate(timer.sessionId)}
              accessibilityRole="button"
              accessibilityLabel="Seansı iptal et"
            >
              <Text style={styles.ghostButtonText}>Vazgeç</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.idlePane}>
          <Text style={styles.title}>Bugün</Text>
          <Text style={styles.subtitle}>Bir alışkanlık seç ve başla.</Text>

          <FlatList
            data={habits}
            keyExtractor={(habit) => habit.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Henüz alışkanlık yok.</Text>}
            renderItem={({ item }: { item: Habit }) => (
              <Pressable
                style={[styles.habitCard, busy && styles.buttonDisabled]}
                disabled={busy}
                onPress={() => startMutation.mutate(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} seansı başlat`}
              >
                <View
                  style={[
                    styles.habitDot,
                    { backgroundColor: item.stat ? statColors[item.stat] : item.colorHex },
                  ]}
                />
                <View style={styles.habitText}>
                  <Text style={styles.habitName}>{item.name}</Text>
                  <Text style={styles.habitMeta}>
                    {item.targetMinutes} dk
                    {item.currentStreak > 0 ? ` · ${item.currentStreak} günlük seri` : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      )}

      {error && <Text style={styles.errorBanner}>{error}</Text>}

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
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  empty: { ...type.body, color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl },

  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  habitDot: { width: 10, height: 10, borderRadius: radius.pill },
  habitText: { flex: 1, gap: 2 },
  habitName: { ...type.heading, color: colors.text },
  habitMeta: { ...type.caption, color: colors.textMuted },

  runningPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  runningHabit: { ...type.label, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  timer: { ...type.timer, color: colors.text },
  runningMeta: { ...type.caption, color: colors.textFaint, marginBottom: spacing.xl },

  actions: { width: '100%', gap: spacing.sm },
  primaryButton: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  primaryButtonText: { ...type.heading, color: '#FFFFFF' },
  ghostButton: { paddingVertical: spacing.md, alignItems: 'center' },
  ghostButtonText: { ...type.label, color: colors.textFaint },
  secondaryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  secondaryButtonText: { ...type.label, color: colors.text },
  buttonDisabled: { opacity: 0.5 },

  errorTitle: { ...type.heading, color: colors.text },
  errorBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  errorBanner: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
    padding: spacing.md,
  },
});
