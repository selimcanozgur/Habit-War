/**
 * Category choice, as a wrap of tinted pills.
 *
 * Shared by the habit and duel forms so a category looks the same wherever the user
 * picks one: its icon in its colour, filled with that colour once chosen.
 */

import type { Category } from '@habitwar/domain';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { categoryColors, categoryLabels, colors, radius, spacing, type } from '../theme';
import { CATEGORY_ICONS, Icon } from './Icon';

/** Display order: the categories a new user most often starts with come first. */
export const CATEGORY_ORDER: readonly Category[] = [
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'HEALTH',
  'CREATIVE',
  'SKILL',
  'SOCIAL',
];

const ICON_SIZE = 18;

export interface CategoryPickerProps {
  readonly value: Category | null;
  readonly onChange: (category: Category) => void;
}

export function CategoryPicker({ value, onChange }: CategoryPickerProps): React.JSX.Element {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {CATEGORY_ORDER.map((item) => {
        const selected = item === value;
        const tint = categoryColors[item] ?? colors.accent;
        return (
          <Pressable
            key={item}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(item);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={categoryLabels[item] ?? item}
            style={({ pressed }) => [
              styles.pill,
              selected && { backgroundColor: tint },
              pressed && styles.pressed,
            ]}
          >
            <Icon
              name={CATEGORY_ICONS[item] ?? 'star'}
              size={ICON_SIZE}
              color={selected ? colors.textOnAccent : tint}
            />
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {categoryLabels[item] ?? item}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A row of single-choice pills for short values — minutes, days. Selected takes the
 * accent, the one "this is chosen" cue the app uses.
 */
export function OptionPills<T extends string | number>({
  options,
  value,
  onChange,
  format,
  describe,
}: {
  readonly options: readonly T[];
  readonly value: T | null;
  readonly onChange: (option: T) => void;
  readonly format: (option: T) => string;
  /** Spoken label, when the visible one is an abbreviation. */
  readonly describe?: (option: T) => string;
}): React.JSX.Element {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={String(option)}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(option);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={describe ? describe(option) : format(option)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, styles.tabular, selected && styles.labelSelected]}>
              {format(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md - 2,
    minHeight: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  option: {
    minHeight: 36,
    minWidth: 56,
    paddingHorizontal: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  optionSelected: { backgroundColor: colors.accent },
  pressed: { opacity: 0.6 },
  label: { ...type.label, color: colors.text },
  labelSelected: { color: colors.textOnAccent },
  tabular: { fontVariant: ['tabular-nums'] },
});
