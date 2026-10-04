/**
 * A labelled text input.
 *
 * Built for the auth screens, which are the first thing a new user meets and the one
 * place where a vague error costs the account. Three things it insists on:
 *
 *  - The error sits under the field it belongs to, not in a banner at the top. A
 *    banner makes the user hunt for which field it means.
 *  - An errored field is outlined *and* captioned. Colour alone fails for anyone who
 *    cannot distinguish red, so the caption says it in words.
 *  - The password visibility toggle is a real button with a label, because typing a
 *    password blind on a phone keyboard is how people end up locked out of accounts
 *    they created correctly.
 */

import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, type } from '../theme';
import { Icon } from './Icon';

const TOGGLE_ICON_SIZE = 20;

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string;
  /** Shown under the field, in the error tone. */
  readonly error?: string | undefined;
  /** Shown under the field when there is no error. */
  readonly hint?: string | undefined;
  /** Adds the show/hide toggle and starts obscured. */
  readonly secure?: boolean;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, error, hint, secure = false, ...inputProps },
  ref,
): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const hasError = error !== undefined && error !== '';

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <View style={[styles.inputRow, hasError && styles.inputRowError]}>
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={secure && !revealed}
          // Password managers need this to offer to fill and to save; without it a
          // user who relies on one has to type a long password by hand.
          autoCorrect={false}
          {...inputProps}
        />

        {secure && (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            hitSlop={spacing.sm}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Şifreyi gizle' : 'Şifreyi göster'}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Icon
              name={revealed ? 'eye-off' : 'eye'}
              size={TOGGLE_ICON_SIZE}
              color={colors.textMuted}
            />
          </Pressable>
        )}
      </View>

      {hasError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    // Transparent until it has something to say: the fill marks the field, and an
    // edge appears only for an error, so the error is the one thing that stands out.
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: spacing.md,
  },
  inputRowError: { borderColor: colors.danger },

  input: {
    ...type.body,
    color: colors.text,
    flex: 1,
    // Tall enough to be an easy target on a phone and to clear Turkish descenders.
    paddingVertical: spacing.md,
  },

  toggle: { padding: spacing.xs },
  togglePressed: { opacity: 0.6 },

  error: { ...type.caption, color: colors.danger },
  hint: { ...type.caption, color: colors.textFaint },
});
