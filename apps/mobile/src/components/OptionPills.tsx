/**
 * A row of single-choice pills for short values — a daily goal, a reminder time, a
 * language. Selected takes the accent, the one "this is chosen" cue the app uses.
 */

import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

export function OptionPills<T extends string | number | null>({
  options,
  value,
  onChange,
  format,
  describe,
}: {
  readonly options: readonly T[];
  readonly value: T;
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
  option: {
    minHeight: 40,
    minWidth: 56,
    paddingHorizontal: spacing.md - 2,
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
