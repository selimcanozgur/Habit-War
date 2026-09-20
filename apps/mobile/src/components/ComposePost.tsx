/**
 * The composer.
 *
 * Short-form on purpose. The spec's noise concern (§5.1) is that the feed fills with
 * machine output; the counterweight is that writing something by hand should be cheap
 * and fast, so this is a single collapsed row that expands on focus rather than a
 * modal the user has to decide to open.
 *
 * The character limit is enforced at the input (`maxLength`) rather than on submit,
 * because a post rejected after typing 600 characters is a worse experience than one
 * that simply stops accepting them.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { colors, radius, spacing, type } from '../theme';

export const MAX_POST_LENGTH = 500;
/** Below this many characters left, the counter turns into a warning. */
const COUNTER_WARN_AT = 50;

export interface ComposePostProps {
  readonly onSubmit: (content: string) => void;
  readonly isSubmitting: boolean;
  /** Set when the last submit failed, so the user can see why and retry. */
  readonly errorMessage?: string | null | undefined;
}

export function ComposePost({
  onSubmit,
  isSubmitting,
  errorMessage,
}: ComposePostProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);

  const trimmed = text.trim();
  const remaining = MAX_POST_LENGTH - text.length;
  const canSubmit = trimmed.length > 0 && remaining >= 0 && !isSubmitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSubmit(trimmed);
    // Clear eagerly. The screen re-opens the composer with the text restored if the
    // mutation fails, so nothing is lost and the common path feels instant.
    setText('');
    setExpanded(false);
  }, [canSubmit, onSubmit, trimmed]);

  return (
    <Animated.View style={styles.container} layout={LinearTransition.duration(180)}>
      <TextInput
        style={[styles.input, expanded && styles.inputExpanded]}
        value={text}
        onChangeText={setText}
        onFocus={() => setExpanded(true)}
        placeholder="Bugün ne üzerinde çalıştın?"
        placeholderTextColor={colors.textFaint}
        multiline={expanded}
        maxLength={MAX_POST_LENGTH}
        editable={!isSubmitting}
        accessibilityLabel="Gönderi metni"
        accessibilityHint={`En fazla ${MAX_POST_LENGTH} karakter`}
      />

      {expanded && (
        <Animated.View entering={FadeIn.duration(150)} style={styles.actions}>
          <Text
            style={[styles.counter, remaining <= COUNTER_WARN_AT && styles.counterWarn]}
            accessibilityLabel={`${remaining} karakter kaldı`}
          >
            {remaining}
          </Text>

          <Pressable
            onPress={() => {
              setText('');
              setExpanded(false);
            }}
            style={styles.cancelButton}
            accessibilityRole="button"
            accessibilityLabel="Gönderiyi iptal et"
          >
            <Text style={styles.cancelText}>Vazgeç</Text>
          </Pressable>

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Gönderiyi paylaş"
            accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.submitText}>Paylaş</Text>
            )}
          </Pressable>
        </Animated.View>
      )}

      {errorMessage ? (
        <Text style={styles.error} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    ...type.body,
    color: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
  inputExpanded: { minHeight: 88, textAlignVertical: 'top' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  counter: {
    ...type.caption,
    color: colors.textFaint,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  counterWarn: { color: colors.warning },

  cancelButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  cancelText: { ...type.label, color: colors.textFaint },

  submitButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    minWidth: 84,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { ...type.label, color: '#FFFFFF' },

  error: { ...type.caption, color: colors.danger, paddingHorizontal: spacing.sm },
});
