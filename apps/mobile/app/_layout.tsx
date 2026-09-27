/**
 * App root.
 *
 * Holds the three things every screen depends on: the query client, the font load,
 * and the tab bar.
 *
 * Auth is still the API's dev mode, so the token provider sends `x-dev-user-id`.
 * When Clerk sign-in lands, only this provider changes — the API client already
 * takes whatever headers it is handed.
 */

import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View, type ColorValue } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError, setAuthHeaderProvider } from '../src/api/client';
import { Icon, type IconName } from '../src/components/Icon';
import { colors } from '../src/theme';

/** Dev-mode identity. Replaced by a Clerk session token. */
const DEV_USER_ID = (Constants.expoConfig?.extra?.['devUserId'] as string | undefined) ?? '';

setAuthHeaderProvider(async () => {
  const headers: Record<string, string> = {};
  if (DEV_USER_ID) headers['x-dev-user-id'] = DEV_USER_ID;
  return headers;
});

/**
 * Tab icon.
 *
 * Filled when active, outlined when not — the convention every iOS and Android user
 * already reads without being taught, and the reason the active tab does not have to
 * rely on colour alone. Both variants come from the same generated set, so they share
 * a grid and a stroke weight.
 */
function tabIcon(name: IconName, activeName: IconName) {
  return function TabIcon({
    color,
    focused,
  }: {
    color: ColorValue;
    focused: boolean;
  }): React.JSX.Element {
    return <Icon name={focused ? activeName : name} size={24} color={color as string} />;
  };
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

  // Held rather than rendered with a fallback face: every size in the type scale is
  // set for Nunito's metrics, so a system-font first paint would reflow the whole
  // app a beat later.
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
        desktop app. On a real device the cap is wider than the screen, so it does
        nothing.
      */}
      <View style={styles.frame}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="light" />
            <Tabs
            screenOptions={{
              headerShown: false,
              sceneStyle: { backgroundColor: colors.bg },
              tabBarStyle: {
                // Dark stone, per the design: the tab bar is the frame around the
                // parchment pages rather than another page.
                backgroundColor: colors.stone,
                borderTopColor: colors.frame,
                borderTopWidth: 2,
                // Tall enough for a 24px icon, its label, and breathing room above
                // the home indicator. At 62 the descenders in "Bugün" were clipped.
                height: 74,
                paddingTop: 8,
                paddingBottom: 12,
              },
              tabBarActiveTintColor: colors.gold,
              tabBarInactiveTintColor: colors.textOnDarkMuted,
              tabBarLabelStyle: {
                fontFamily: 'Nunito_700Bold',
                fontSize: 11,
                // Turkish labels carry descenders and dotted capitals; the default
                // line height crops both.
                lineHeight: 15,
                marginTop: 2,
              },
            }}
          >
            {/* Order follows the spec's information architecture (§9). */}
            <Tabs.Screen
              name="index"
              options={{ title: 'Bugün', tabBarIcon: tabIcon('today', 'today-filled') }}
            />
            <Tabs.Screen
              name="feed"
              options={{ title: 'Akış', tabBarIcon: tabIcon('feed', 'feed-filled') }}
            />
            <Tabs.Screen
              name="battle"
              options={{ title: 'Savaş', tabBarIcon: tabIcon('battle', 'battle-filled') }}
            />
            <Tabs.Screen
              name="friends"
              options={{
                title: 'Arkadaşlar',
                tabBarIcon: tabIcon('friends', 'friends-filled'),
              }}
            />
            <Tabs.Screen
              name="profile"
              options={{ title: 'Profil', tabBarIcon: tabIcon('profile', 'profile-filled') }}
            />
            </Tabs>
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
