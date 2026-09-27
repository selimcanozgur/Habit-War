/**
 * The app's button.
 *
 * The whole point is the bottom edge. A solid control sits on a darker slab of
 * itself and compresses into it when pressed — which reads as physical in a way a
 * shadow does not, and unlike a shadow it survives on a white screen where soft
 * shadows disappear.
 *
 * Implemented as two stacked views rather than a border: a bottom border would move
 * the content on press, and animating a border width is not worklet-friendly. The
 * outer view is the slab, the inner one slides down onto it.
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, depth, radius, spacing, type } from '../theme';

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

const TONES: Readonly<Record<ButtonTone, { face: string; edge: string; label: string }>> = {
  primary: { face: colors.accent, edge: colors.accentDark, label: colors.textOnAccent },
  success: { face: colors.success, edge: colors.successDark, label: colors.textOnAccent },
  // Anything that spends or advances progression rather than merely navigating.
  xp: { face: colors.xp, edge: colors.xpDark, label: colors.textOnAccent },
  danger: { face: colors.danger, edge: colors.dangerDark, label: colors.textOnAccent },
  // The quiet one: a parchment face on a warm edge, for anything that is not the
  // action the screen is asking for.
  neutral: { face: colors.surface, edge: colors.borderStrong, label: colors.text },
};

/** Fast enough to feel like a physical press rather than an animation. */
const PRESS_MS = 60;

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
  const press = useSharedValue(0);
  const palette = TONES[tone];
  const inert = disabled || loading;

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: press.value * depth.button }],
  }));

  const handlePressIn = useCallback(() => {
    press.value = withTiming(1, { duration: PRESS_MS });
  }, [press]);

  const handlePressOut = useCallback(() => {
    press.value = withTiming(0, { duration: PRESS_MS });
  }, [press]);

  const handlePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[
        styles.slab,
        { backgroundColor: palette.edge },
        block && styles.block,
        inert && styles.inert,
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.face,
          size === 'small' ? styles.faceSmall : styles.faceLarge,
          {
            backgroundColor: palette.face,
            // The neutral tone is the only one that needs an outline; a white face
            // on a grey slab would otherwise have no edge of its own.
            borderWidth: tone === 'neutral' ? 2 : 0,
            borderColor: colors.border,
          },
          faceStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.label} />
        ) : (
          <Text
            style={[
              size === 'small' ? styles.labelSmall : styles.labelLarge,
              { color: palette.label },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * A small pill for a secondary action inside a row — accept, decline, cancel.
 * Shares the palette but not the slab: at this size the edge reads as clutter.
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
        {
          backgroundColor: palette.face,
          borderColor: tone === 'neutral' ? colors.border : palette.edge,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.chipLabel, { color: palette.label }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slab: {
    borderRadius: radius.md,
    // The slab is exactly `depth` taller than the face; the face covers all of it
    // at rest and none of it when pressed.
    paddingBottom: depth.button,
  },
  block: { alignSelf: 'stretch' },
  inert: { opacity: 0.45 },

  face: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceLarge: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  faceSmall: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },

  labelLarge: { ...type.heading, letterSpacing: 0.3 },
  labelSmall: { ...type.label },

  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  chipLabel: { ...type.label },
});

/** Shared card surface, so every screen's container is the same object. */
export const cardStyle: ViewStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 2,
  borderColor: colors.border,
  padding: spacing.md,
};
