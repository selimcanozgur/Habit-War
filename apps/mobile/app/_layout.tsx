/**
 * App root.
 *
 * Auth is still the API's dev mode, so the token provider sends `x-dev-user-id`.
 * When Clerk sign-in lands, only this provider changes — the API client already
 * takes whatever headers it is handed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError, setAuthHeaderProvider } from '../src/api/client';
import { colors } from '../src/theme';

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
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'fade',
            }}
          />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
