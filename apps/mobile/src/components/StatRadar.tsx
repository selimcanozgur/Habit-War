/**
 * The six-stat visualisation.
 *
 * DESIGN DECISION — horizontal bars, not a polygon radar.
 *
 * The brief allowed either a pure-View hexagonal radar or a horizontal bar list, and
 * asked for the reasoning. Bars won on four counts:
 *
 *  1. Accuracy. A radar without `react-native-svg` means building the polygon out of
 *     rotated, skewed Views. Six triangular wedges, each skewed 30deg and clipped,
 *     approximate the shape but cannot draw the *web* (the filled irregular hexagon
 *     joining the six vertices) at all — that needs a real path. What you get is six
 *     independent spokes, which is a worse bar chart wearing a circle's costume.
 *
 *  2. Readability. Position along a common baseline is the most accurately decoded
 *     visual channel; area inside a polygon is among the least. The screen's job is
 *     "which stats am I neglecting", and bars answer that at a glance.
 *
 *  3. Labels. Six labels around a hexagon either overlap or shrink below legible
 *     size at 360dp. Bars give every stat a full-width row with its Turkish name,
 *     its value, and room for a progress figure.
 *
 *  4. Accessibility. Each row is a real element with its own accessibility label, so
 *     a screen reader reads "Güç, 12 puan". A hexagon of transform-hacked Views is
 *     an unlabelled blob.
 *
 * The bars are still ordered ALL_STATS-style (STR, END, INT, WIS, CHA, DEX) so the
 * stat sheet keeps a stable reading order everywhere it appears, exactly as the
 * radar would have.
 *
 * Bars animate their width on mount and whenever a value changes, reusing XpBar's
 * approach: a shared value driven with `withTiming` and read back in an animated
 * style. Growth is the point — a stat that snaps into place reads as a static
 * number rather than something the user built.
 */

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { Stat } from '@habitwar/domain';

import { colors, radius, spacing, statColors, statLabels, type } from '../theme';

/** Fixed display order — matches ALL_STATS in the domain package. */
const STAT_ORDER: readonly Stat[] = ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX'];

const GROW_MS = 700;
/** Staggering the six rows makes the sheet read as a sequence instead of a flash. */
const STAGGER_MS = 60;

/**
 * Floor for the bar scale.
 *
 * Without it a brand-new account with a single point in STR renders one full-width
 * bar and five empty ones, implying mastery the user has not earned. Scaling against
 * at least 10 keeps early progress honest and proportionate.
 */
const MIN_SCALE = 10;

export interface StatRadarProps {
  /** Displayed stat points, one entry per stat. */
  readonly stats: Readonly<Record<Stat, number>>;
}

export function StatRadar({ stats }: StatRadarProps): React.JSX.Element {
  // Scale every bar against the strongest stat, so the chart shows the user's own
  // balance rather than their progress toward some absolute ceiling the game has no
  // concept of. Stats are uncapped, so an absolute scale is not even definable.
  const peak = Math.max(MIN_SCALE, ...STAT_ORDER.map((stat) => stats[stat]));
  const total = STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);

  if (total === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Statlar</Text>
        </View>
        <Text style={styles.empty}>
          Henüz stat puanın yok. İlk seansını tamamladığında alışkanlığın beslediği stat
          burada yükselmeye başlayacak.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Statlar</Text>
        <Text style={styles.total}>{total} puan</Text>
      </View>

      <View style={styles.rows}>
        {STAT_ORDER.map((stat, index) => (
          <StatRow
            key={stat}
            stat={stat}
            value={stats[stat]}
            ratio={stats[stat] / peak}
            delayMs={index * STAGGER_MS}
          />
        ))}
      </View>
    </View>
  );
}

interface StatRowProps {
  readonly stat: Stat;
  readonly value: number;
  readonly ratio: number;
  readonly delayMs: number;
}

function StatRow({ stat, value, ratio, delayMs }: StatRowProps): React.JSX.Element {
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withDelay(
      delayMs,
      withTiming(ratio, { duration: GROW_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [ratio, delayMs, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, fill.value * 100))}%`,
  }));

  const color = statColors[stat];

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${statLabels[stat]}: ${value} puan`}
    >
      <Text style={styles.statLabel} numberOfLines={1}>
        {statLabels[stat]}
      </Text>

      <View style={styles.track}>
        {/*
          A hairline of colour stays visible even at zero, so an untouched stat still
          carries its identity colour and the row never looks broken.
        */}
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      </View>

      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { ...type.heading, color: colors.text },
  total: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  empty: { ...type.body, color: colors.textFaint, lineHeight: 21 },

  rows: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Fixed width keeps every bar starting on the same baseline, which is the whole
  // reason bars beat a radar here.
  statLabel: { ...type.label, color: colors.textMuted, width: 92 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, minWidth: 3 },
  statValue: {
    ...type.label,
    width: 32,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
