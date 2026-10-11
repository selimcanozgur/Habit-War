/**
 * A destructive-action confirmation that works on every target.
 *
 * react-native-web implements `Alert.alert` as a no-op, so on the web preview a
 * confirmation built on it never appears and the action never runs. The browser's
 * own dialog stands in there.
 */

import { Alert, Platform } from 'react-native';

export function confirmDestructive(options: {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    if (window.confirm(`${options.title}\n\n${options.message}`)) options.onConfirm();
    return;
  }
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel, style: 'cancel' },
    { text: options.confirmLabel, style: 'destructive', onPress: options.onConfirm },
  ]);
}
