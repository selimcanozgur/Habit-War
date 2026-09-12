/**
 * The XP bar.
 *
 * The spec calls this the heart of the product, and it is right: filling this bar is
 * the reward stage of the habit loop. A bar that jumps to its new value teaches the
 * user nothing; a bar that *travels* is the payoff for the thirty minutes they just
 * spent.
 *
 * Two cases it has to handle:
 *  - Normal gain: the fill animates from where it was to where it is.
 *  - Level up: the fill runs to 100%, snaps to empty, then continues into the new
 *    level. Crossfading straight to the new ratio would hide the moment the user is
 *    actually here for.
 */

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing, type } from '../theme';

/** Long enough to read as movement, short enough not to make the user wait. */
const FILL_MS = 900;
/** The pause at a full bar before it resets — this is the level-up beat. */
const HOLD_MS = 260;
const RESET_MS = 180;

export interface XpBarProps {
  /** 0..1 progress within the current level. */
  readonly ratio: number;
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  /** Set when the last award crossed a level boundary. */
  readonly leveledUp?: boolean;
  /** Fires when the fill animation settles; drives the level-up celebration. */
  readonly onFillComplete?: () => void;
}

export function XpBar({
  ratio,
  level,
  xpIntoLevel,
  xpForNextLevel,
  leveledUp = false,
  onFillComplete,
}: XpBarProps): React.JSX.Element {
  const fill = useSharedValue(ratio);

  useEffect(() => {
    const settle = (finished?: boolean): void => {
      'worklet';
      if (finished && onFillComplete) runOnJS(onFillComplete)();
    };

    if (leveledUp) {
      // Run out the old level, blank the bar, then fill into the new one.
      fill.value = withSequence(
        withTiming(1, { duration: FILL_MS * 0.6, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: HOLD_MS }),
        withTiming(0, { duration: RESET_MS, easing: Easing.in(Easing.quad) }),
        withTiming(ratio, { duration: FILL_MS, easing: Easing.out(Easing.cubic) }, settle),
      );
    } else {
      fill.value = withTiming(
        ratio,
        { duration: FILL_MS, easing: Easing.out(Easing.cubic) },
        settle,
      );
    }
    // `fill` is a stable shared value and `onFillComplete` is wrapped by the caller;
    // re-running on every render would restart the animation mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, leveledUp]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, fill.value * 100))}%`,
  }));

  const atMaxLevel = xpForNextLevel === 0;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.level}>Seviye {level}</Text>
        <Text style={styles.counter}>
          {atMaxLevel ? 'Azami seviye' : `${xpIntoLevel} / ${xpForNextLevel} XP`}
        </Text>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  level: { ...type.heading, color: colors.text },
  counter: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
