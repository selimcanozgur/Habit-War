/**
 * App root.
 *
 * Holds three things every screen depends on: the query client, the font load, and
 * the session. Auth is now this product's own JWT stack — the AuthProvider restores
 * a stored session on launch and hands the API client a fresh token for every request.
 * When no session exists the user is routed to the sign-in screen; once a session
 * is established they go to the tabs. Neither the tabs nor the auth screens have to
 * know about each other.
 */

import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Slot, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/theme';

/**
 * Session gate.
 *
 * Sits between the provider and the rendered route tree. While the stored session
 * is being restored it shows a spinner — the Slot underneath would flash the sign-in
 * screen and then snap to the tabs, which looks like a bug. Once the restore settles,
 * it redirects based on whether a user is present.
 *
 * expo-router's Redirect component replaces the current history entry rather than
 * pushing a new one, so the user cannot "back" into a state that no longer applies.
 */
function SessionGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, isRestoring } = useAuth();
  const segments = useSegments();

  // The first segment tells us which route group is active.
  const inAuthGroup = segments[0] === '(auth)';

  if (isRestoring) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // No session and not already in the auth group → go to sign-in.
  if (!user && !inAuthGroup) return <Redirect href="/(auth)/sign-in" />;

  // Session exists but still on an auth screen → go to the tab root.
  if (user && inAuthGroup) return <Redirect href="/(tabs)" />;

  return <>{children}</>;
}

export default function RootLayout(): React.JSX.Element {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: 0 },
        },
      }),
    [],
  );

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      {/*
        On the web target the viewport is a desktop window, and every screen here is
        laid out for a handset — stretched to 1280px the cards become letterboxes and
        the tab bar spreads its five items across a metre of glass. Capping the frame
        keeps the web build an honest preview of the phone rather than a broken
        desktop app.
      */}
      <View style={styles.frame}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <StatusBar style="light" />
              {/*
                SessionGate reads the auth state inside the AuthProvider and redirects
                to sign-in when no session exists. The Slot inside it renders the
                matched child segment — (auth) gets its own Stack, (tabs) gets its own
                Tab navigator. This root layout does not prescribe either one.
              */}
              <SessionGate>
                <Slot />
              </SessionGate>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

/** Widest a handset layout should ever be stretched. */
const PHONE_FRAME_WIDTH = 460;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.stone,
    alignItems: 'center',
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: PHONE_FRAME_WIDTH,
    backgroundColor: colors.bg,
  },
});
