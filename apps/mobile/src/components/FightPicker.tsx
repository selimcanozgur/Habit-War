/**
 * "Which habit do you fight with?" — the player's timed habits, the ones that hit the
 * current monster's weakness first. A fight is a habit session; there is no other
 * way to deal damage. When nothing hits the weakness, the catalog is one tap away.
 */

import {
  CATEGORY_DEFAULT_STAT,
  WEAKNESS_DAMAGE_MULTIPLIER,
  resolveStat,
  type Category,
  type Stat,
} from '@habitwar/domain';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Habit } from '../api/sessions';
import { colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { CATEGORY_ICONS, Icon } from './Icon';

/** The first category whose habits train a stat by default. */
export function categoryForStat(stat: Stat): Category | undefined {
  return (Object.entries(CATEGORY_DEFAULT_STAT) as [Category, Stat][]).find(([, value]) => value === stat)?.[0];
}

export function FightPicker({
  habits,
  weakness,
  busy = false,
  onPick,
  onAddHabit,
}: {
  readonly habits: readonly Habit[];
  readonly weakness: Stat;
  readonly busy?: boolean;
  readonly onPick: (habitId: string) => void;
  /** Opens the habit catalog with the weakness's group in front. */
  readonly onAddHabit: (category?: Category) => void;
}): React.JSX.Element {
  const tint = statColors[weakness];
  // Count habits are fought with quick taps on Bugün, not with a timer.
  const fighters = habits
    .filter((habit) => habit.kind !== 'COUNT')
    .map((habit) => ({ habit, weak: resolveStat(habit.category, habit.stat) === weakness }))
    .sort((a, b) => Number(b.weak) - Number(a.weak));

  return (
    <View style={styles.wrap}>
      {fighters.map(({ habit, weak }) => (
        <Pressable
          key={habit.id}
          disabled={busy}
          onPress={() => onPick(habit.id)}
          accessibilityRole="button"
          accessibilityLabel={`${habit.name} ile savaş${weak ? ', zayıf noktasına vurur' : ''}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed, busy && styles.busy]}
        >
          <Icon name={CATEGORY_ICONS[habit.category] ?? 'play'} size={18} color={colors.textMuted} />
          <Text style={styles.name} numberOfLines={1}>
            {habit.name}
          </Text>
          {weak && (
            <Text style={[styles.weak, { color: tint }]}>×{WEAKNESS_DAMAGE_MULTIPLIER} zayıf nokta</Text>
          )}
          <Icon name="play-filled" size={20} color={colors.accent} />
        </Pressable>
      ))}

      {!fighters.some((item) => item.weak) && (
        <Pressable
          onPress={() => onAddHabit(categoryForStat(weakness))}
          accessibilityRole="button"
          style={({ pressed }) => [styles.suggest, pressed && styles.pressed]}
        >
          <Icon name="plus" size={16} color={tint} />
          <Text style={[styles.suggestText, { color: tint }]}>
            Zayıflığına uygun hazır alışkanlık ekle ({statLabels[weakness]} ×{WEAKNESS_DAMAGE_MULTIPLIER})
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: { opacity: 0.7 },
  busy: { opacity: 0.5 },
  name: { ...type.body, color: colors.text, flex: 1 },
  weak: { ...type.caption, fontFamily: 'Nunito_800ExtraBold' },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  suggestText: { ...type.label, flex: 1 },
});
