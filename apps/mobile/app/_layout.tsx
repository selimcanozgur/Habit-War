/**
 * App root.
 *
 * Auth is still the API's dev mode, so the token provider sends `x-dev-user-id`.
 * When Clerk sign-in lands, only this provider changes — the API client already
 * takes whatever headers it is handed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { Text, type ColorValue } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError, setAuthHeaderProvider } from '../src/api/client';
import { colors } from '../src/theme';

/**
 * Tab icon factory.
 *
 * No icon set is installed, so a glyph stands in. Kept as a factory so the colour
 * still tracks the active/inactive tint rather than being hardcoded.
 */
function tabGlyph(glyph: string) {
  // `color` arrives as RN's ColorValue, not string — it can be an opaque platform
  // colour — so it is passed straight through to the style rather than narrowed.
  return function TabGlyph({ color }: { color: ColorValue }): React.JSX.Element {
    return <Text style={{ color, fontSize: 18, lineHeight: 22 }}>{glyph}</Text>;
  };
}

/** Dev-mode identity. Replaced by a Clerk session token. */
const DEV_USER_ID = (Constants.expoConfig?.extra?.['devUserId'] as string | undefined) ?? '';

setAuthHeaderProvider(async () => {
  const headers: Record<string, string> = {};
  if (DEV_USER_ID) headers['x-dev-user-id'] = DEV_USER_ID;
  return headers;
});

export default function RootLayout(): React.JSX.Element {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // Retrying a 401 or a 422 just burns battery; only transient failures
              // are worth a second attempt.
              if (error instanceof ApiError && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: 0 },
        },
      }),
    [],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Tabs
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: colors.bg },
              tabBarStyle: {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
              tabBarActiveTintColor: colors.accentBright,
              tabBarInactiveTintColor: colors.textFaint,
              tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
            }}
          >
            {/*
              Tab order follows the spec's information architecture (§9), with the
              competitive tab in the centre where the spec wants the emphasis. No icon
              library is installed yet, so each tab draws a glyph — replacing these with
              real icons is a one-line change per screen.
            */}
            <Tabs.Screen
              name="index"
              options={{ title: 'Ana Sayfa', tabBarIcon: tabGlyph('◈') }}
            />
            <Tabs.Screen name="feed" options={{ title: 'Akış', tabBarIcon: tabGlyph('≡') }} />
            <Tabs.Screen name="battle" options={{ title: 'Savaş', tabBarIcon: tabGlyph('⚔') }} />
            <Tabs.Screen
              name="friends"
              options={{ title: 'Arkadaşlar', tabBarIcon: tabGlyph('◎') }}
            />
            <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: tabGlyph('☗') }} />
          </Tabs>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
