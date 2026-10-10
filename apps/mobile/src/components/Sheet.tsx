/**
 * A bottom sheet: a modal panel that slides up over a dimmed screen.
 *
 * Used for every short task that belongs to the screen underneath — logging pages,
 * adding a book — so the user never loses their place for a ten-second action.
 */

import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../i18n';
import { colors, radius, spacing, type } from '../theme';
import { Icon } from './Icon';

export interface SheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

export function Sheet({ visible, title, onClose, children }: SheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.common.cancel}
        />
        <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={spacing.sm}
              accessibilityRole="button"
              accessibilityLabel={t.common.cancel}
            >
              <Icon name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20, 19, 15, 0.45)' },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { ...type.title, color: colors.text, flex: 1 },
  body: { padding: spacing.md, gap: spacing.md },
});
