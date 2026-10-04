/**
 * Auth group layout.
 *
 * A bare stack with no header — each auth screen draws its own header so it can
 * stay plain rather than wearing the system chrome.
 *
 * Once a session exists, sign-in has nothing left to do here: the user goes to the tabs.
 */

import { Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useAuth } from '../../src/auth/AuthContext';

export default function AuthLayout(): React.JSX.Element {
  const { user } = useAuth();
  if (user) return <Redirect href="/(tabs)" />;

  // The auth screens sit straight on the yellow page, with no dark hero behind the
  // status bar, so its text has to be dark here.
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </>
  );
}
