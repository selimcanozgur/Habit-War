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
 *
 * The field itself is drawn as a recessed well inside the card: on a white page a
 * white input with a hairline border does not read as something you can type into.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { colors, radius, spacing, type } from '../theme';
import { Button, cardStyle, ChipButton } from './Button';

export const MAX_POST_LENGTH = 500;
/** Below this many characters left, the counter turns into a warning. */
const COUNTER_WARN_AT = 50;

/** Inline icon beside the prompt. */
const ICON_SIZE = 18;

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
    // No haptic here: `Button` already fires the same light impact on press, and two
    // of them in the same frame reads as a stutter rather than a confirmation.
    onSubmit(trimmed);
    // Clear eagerly. The screen re-opens the composer with the text restored if the
    // mutation fails, so nothing is lost and the common path feels instant.
    setText('');
    setExpanded(false);
  }, [canSubmit, onSubmit, trimmed]);

  const handleCancel = useCallback(() => {
    setText('');
    setExpanded(false);
  }, []);

  return (
    <Animated.View style={styles.container} layout={LinearTransition.duration(180)}>
      <View style={[styles.well, expanded && styles.wellExpanded]}>
        {!expanded && (
          <Ionicons name="create-outline" size={ICON_SIZE} color={colors.textFaint} />
        )}
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
      </View>

      {expanded && (
        <Animated.View entering={FadeIn.duration(150)} style={styles.actions}>
          <Text
            style={[styles.counter, remaining <= COUNTER_WARN_AT && styles.counterWarn]}
            accessibilityLabel={`${remaining} karakter kaldı`}
          >
            {remaining}
          </Text>

          <ChipButton
            label="Vazgeç"
            onPress={handleCancel}
            accessibilityLabel="Gönderiyi iptal et"
          />

          <Button
            label="Paylaş"
            tone="primary"
            size="small"
            block={false}
            loading={isSubmitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
            accessibilityLabel="Gönderiyi paylaş"
            style={styles.submit}
          />
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

/** Wide enough that "Paylaş" and the busy spinner do not resize the row. */
const SUBMIT_MIN_WIDTH = 96;

const styles = StyleSheet.create({
  container: { ...cardStyle, gap: spacing.sm },

  /** The recessed well. Its fill, not a border, is what says "type here". */
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  wellExpanded: { alignItems: 'flex-start', paddingVertical: spacing.sm },

  input: {
    ...type.body,
    color: colors.text,
    flex: 1,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  inputExpanded: { minHeight: 88, textAlignVertical: 'top' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  counter: {
    ...type.label,
    color: colors.textFaint,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  counterWarn: { color: colors.warningDark },

  submit: { minWidth: SUBMIT_MIN_WIDTH },

  error: { ...type.caption, color: colors.danger },
});
