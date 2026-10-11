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

import { useT } from '../i18n';
import { colors, radius, spacing, type } from '../theme';

/** Long enough to read as movement, short enough not to make the user wait. */
const FILL_MS = 900;
/** The pause at a full bar before it resets — this is the level-up beat. */
const HOLD_MS = 260;
const RESET_MS = 180;

const TRACK_HEIGHT = 8;

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
  /**
   * Lays the bar out for a dark ground: track and counter switch to the on-dark
   * palette, and the counter moves beside the track instead of above it.
   *
   * The profile hero needs this. Its previous answer was to put the bar on a pale
   * parchment strip, which over an illustration reads as a patch taped onto the
   * artwork — the character and their progress should be one object, not two.
   */
  readonly onDark?: boolean;
}

export function XpBar({
  ratio,
  level,
  xpIntoLevel,
  xpForNextLevel,
  leveledUp = false,
  onFillComplete,
  compact = false,
  onDark = false,
}: XpBarProps): React.JSX.Element {
  const t = useT();
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

  const counter = (
    <Text style={[styles.counter, onDark && styles.counterOnDark]}>
      {atMaxLevel ? t.profile.maxLevel : `${xpIntoLevel} / ${xpForNextLevel} XP`}
    </Text>
  );

  const track = (
    <View style={[styles.track, onDark && styles.trackOnDark]}>
      <Animated.View style={[styles.fill, onDark && styles.fillOnDark, fillStyle]} />
    </View>
  );

  // On dark the counter sits beside the track on one line; the level is stated by the
  // screen, so a second row carrying only a number would be wasted vertical space over
  // an illustration that is doing work.
  if (onDark) {
    return (
      <View style={styles.rowLayout}>
        <View style={styles.trackFlex}>{track}</View>
        {counter}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        {!compact && (
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{t.profile.levelShort(level)}</Text>
          </View>
        )}
        {counter}
      </View>

      {track}
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
  counterOnDark: {
    color: colors.textOnDark,
    textShadowColor: 'rgba(20, 19, 15, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  // The track and counter share a baseline; the track takes the slack so the counter
  // keeps its intrinsic width and never wraps mid-figure.
  rowLayout: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trackFlex: { flex: 1 },

  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  // Over an illustration a solid track would read as a light bar in its own right, so
  // the empty portion becomes a translucent well instead.
  trackOnDark: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    justifyContent: 'flex-start',
    // A fill at 0% must not show a rounded stub of colour.
    minWidth: 0,
  },
  // XP violet: on the hero this bar is the character's
  // progress, which is the colour XP is counted in everywhere else.
  fillOnDark: { backgroundColor: colors.xp },
});
