/**
 * The running-session bar.
 *
 * A session keeps running when the user leaves the timer — that is the point of
 * deriving time from `startedAt` — so the fact that it runs has to stay visible. This
 * bar sits above the tab bar on every other tab, the way a now-playing bar does: the
 * habit, the live time, and one tap back to the full timer.
 *
 * It reads the same timer store the Bugün screen writes, and repaints on its own
 * interval, so it stays live even on a tab where the timer screen is not mounted.
 */

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { getBestiary } from '../api/monsters';
import { listHabits } from '../api/sessions';
import { formatElapsed, TICK_MS, useTimerStore } from '../stores/timer';
import { colors, radius, spacing, type } from '../theme';
import { CATEGORY_ICONS, Icon } from './Icon';

/** Height the bar takes, so the screens above can leave room for it. */
export const RUNNING_BAR_HEIGHT = 56;

export function RunningSessionBar(): React.JSX.Element | null {
  const sessionId = useTimerStore((state) => state.sessionId);
  const habitId = useTimerStore((state) => state.habitId);
  const elapsedSec = useTimerStore((state) => state.elapsedSec);
  const paused = useTimerStore((state) => state.pausedAtMs !== null);

  // Shares the Bugün screen's cache, so the name costs no request.
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const habit = habitsQuery.data?.habits.find((item) => item.id === habitId) ?? null;
  // The monster this session is hitting, from the battle tab's cache.
  const bestiaryQuery = useQuery({ queryKey: ['monsters'], queryFn: getBestiary });
  const hunted = bestiaryQuery.data?.active?.name ?? null;

  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => useTimerStore.getState().tick(), TICK_MS);
    return () => clearInterval(id);
  }, [sessionId]);

  if (!sessionId) return null;

  const target = habit?.targetMinutes ?? 0;
  const reached = target > 0 && elapsedSec >= target * 60;

  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(160)} style={styles.wrap}>
      <Pressable
        onPress={() => router.navigate('/')}
        accessibilityRole="button"
        accessibilityLabel={`${habit?.name ?? 'Seans'} ${paused ? 'duraklatıldı' : 'sürüyor'}, ${formatElapsed(elapsedSec)}. Zamanlayıcıyı aç.`}
        // Paused reads quieter than running: same bar, the live colour withdrawn.
        style={({ pressed }) => [styles.bar, paused && styles.barPaused, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <Icon
            name={habit ? (CATEGORY_ICONS[habit.category] ?? 'play') : 'play'}
            size={18}
            color={colors.accent}
          />
        </View>

        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>
            {habit?.name ?? 'Seans'}
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {paused
              ? 'Duraklatıldı · devam etmek için dokun'
              : reached
                ? 'Hedef tamam · bitirmek için dokun'
                : hunted !== null
                  ? `${hunted} ile savaşıyorsun`
                  : 'Seans sürüyor'}
          </Text>
        </View>

        <Text style={styles.time}>{formatElapsed(elapsedSec)}</Text>
        <Icon name="chevron-right" size={18} color={colors.textOnAccent} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  bar: {
    height: RUNNING_BAR_HEIGHT - spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    // Violet: the one colour that means "this is live and yours to act on".
    backgroundColor: colors.accent,
  },
  barPaused: { backgroundColor: colors.stone },
  pressed: { opacity: 0.85 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  name: { ...type.label, color: colors.textOnAccent },
  status: { ...type.caption, color: colors.textOnAccent, opacity: 0.85 },
  time: {
    ...type.heading,
    color: colors.textOnAccent,
    fontVariant: ['tabular-nums'],
  },
});
