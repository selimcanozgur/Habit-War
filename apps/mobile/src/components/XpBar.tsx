/**
 * The XP bar.
 *
 * The spec calls this the heart of the product, and it is right: filling this bar is
 * the reward stage of the habit loop. A bar that jumps to its new value teaches the
 * user nothing; a bar that *travels* is the payoff for the thirty minutes they just
 * spent.
 *
 * So it is built heavy on purpose — thick track, a highlight along the top of the
 * fill, and a level badge that reads as an object rather than a caption. On a white
 * ground a thin grey rule would disappear entirely.
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

const TRACK_HEIGHT = 20;

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
  /** Hides the level badge where the screen already states the level. */
  readonly compact?: boolean;
}

export function XpBar({
  ratio,
  level,
  xpIntoLevel,
  xpForNextLevel,
  leveledUp = false,
  onFillComplete,
  compact = false,
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
        {!compact && (
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>Sv {level}</Text>
          </View>
        )}
        <Text style={styles.counter}>
          {atMaxLevel ? 'Azami seviye' : `${xpIntoLevel} / ${xpForNextLevel} XP`}
        </Text>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, fillStyle]}>
          {/*
            A lighter line along the top of the fill. It is what stops a saturated
            block from looking flat, and it is the cheapest possible way to get there
            — no gradient dependency, no overdraw.
          */}
          <View style={styles.shine} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  levelBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  levelBadgeText: { ...type.label, color: colors.textOnAccent },

  counter: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    justifyContent: 'flex-start',
    // A fill at 0% must not show a rounded stub of colour.
    minWidth: 0,
  },
  shine: {
    height: 5,
    marginTop: 4,
    marginHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
  },
});
