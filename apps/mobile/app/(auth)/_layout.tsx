/**
 * Auth group layout.
 *
 * A bare stack with no header — each auth screen draws its own header so it can
 * match the parchment design rather than wearing the system chrome.
 */

import { Stack } from 'expo-router';

export default function AuthLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
  );
}
