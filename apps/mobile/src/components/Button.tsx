/**
 * The app's button.
 *
 * Flat, filled, and quiet about it. The label and the fill carry the action; there is
 * no slab, outline or shadow competing with the content around it. Pressing dims the
 * face, which is the feedback iOS users already read as "this registered".
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

export type ButtonTone = 'primary' | 'success' | 'xp' | 'danger' | 'neutral';
export type ButtonSize = 'large' | 'small';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** Renders full-width. Primary actions almost always want this. */
  readonly block?: boolean;
  readonly accessibilityLabel?: string;
  readonly style?: ViewStyle;
}

const TONES: Readonly<Record<ButtonTone, { face: string; label: string }>> = {
  primary: { face: colors.accent, label: colors.textOnAccent },
  success: { face: colors.success, label: colors.textOnAccent },
  // Anything that spends or advances progression rather than merely navigating.
  xp: { face: colors.xp, label: colors.textOnAccent },
  danger: { face: colors.danger, label: colors.textOnAccent },
  // The quiet one: a tinted face for anything that is not the action the screen is
  // asking for. Still reads as pressable without competing with the primary.
  neutral: { face: colors.accentSoft, label: colors.accent },
};

export function Button({
  label,
  onPress,
  tone = 'primary',
  size = 'large',
  disabled = false,
  loading = false,
  block = true,
  accessibilityLabel,
  style,
}: ButtonProps): React.JSX.Element {
  const palette = TONES[tone];
  const inert = disabled || loading;

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.face,
        size === 'small' ? styles.faceSmall : styles.faceLarge,
        { backgroundColor: palette.face },
        block && styles.block,
        pressed && styles.pressed,
        inert && styles.inert,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.label} />
      ) : (
        <Text
          style={[size === 'small' ? styles.labelSmall : styles.labelLarge, { color: palette.label }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A small pill for a secondary action inside a row — accept, decline, cancel.
 */
export function ChipButton({
  label,
  onPress,
  tone = 'neutral',
  disabled = false,
  accessibilityLabel,
}: Omit<ButtonProps, 'size' | 'block' | 'loading' | 'style'>): React.JSX.Element {
  const palette = TONES[tone];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: palette.face, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.chipLabel, { color: palette.label }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceLarge: { minHeight: 50, paddingHorizontal: spacing.lg },
  faceSmall: { minHeight: 36, paddingHorizontal: spacing.md },
  block: { alignSelf: 'stretch' },
  pressed: { opacity: 0.7 },
  inert: { opacity: 0.4 },

  labelLarge: { ...type.heading },
  labelSmall: { ...type.label },

  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  chipLabel: { ...type.label },
});

/** Shared card surface, so every screen's container is the same object. No edge: the fill against the page is enough. */
export const cardStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  padding: spacing.md,
};
