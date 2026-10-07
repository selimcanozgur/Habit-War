/** A plain "‹ Hikaye" link for the story's inner pages, which sit outside the tab bar's own back. */

import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, spacing, type } from '../theme';
import { Icon } from './Icon';

export function BackLink({ label, href }: { readonly label: string; readonly href: Href }): React.JSX.Element {
  return (
    <Pressable
      onPress={() => router.navigate(href)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${label} sayfasına dön`}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Icon name="chevron-left" size={18} color={colors.accent} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  pressed: { opacity: 0.6 },
  text: { ...type.label, color: colors.accent },
});
