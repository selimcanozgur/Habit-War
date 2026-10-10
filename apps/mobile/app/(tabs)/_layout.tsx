/**
 * Tab navigator: Bugün, Raf, Profil.
 *
 * Signed-out users are sent to sign-in from here rather than from the root layout:
 * the root must keep rendering its Slot for the navigation to land. A reader who has
 * not been through the first-run flow is sent there before any tab renders.
 *
 * Once the profile loads, the app language follows the account's setting. The
 * server writes reminders in that language, so the app and its notifications must
 * agree.
 */

import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View, type ColorValue } from 'react-native';

import { getProfile, PROFILE_KEY } from '../../src/api/me';
import { useAuth } from '../../src/auth/AuthContext';
import { Icon, type IconName } from '../../src/components/Icon';
import { fromServerLocale, useLanguage, useT } from '../../src/i18n';
import { useRegisterPush } from '../../src/push';
import { colors, hairline } from '../../src/theme';

/** Filled when active, outlined when not, so the active tab never relies on colour alone. */
function tabIcon(name: IconName, activeName: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }): React.JSX.Element {
    return <Icon name={focused ? activeName : name} size={24} color={color as string} />;
  };
}

export default function TabsLayout(): React.JSX.Element {
  const { user } = useAuth();
  const t = useT();
  const setLang = useLanguage((state) => state.setLang);
  const profileQuery = useQuery({ queryKey: PROFILE_KEY, queryFn: getProfile, enabled: user !== null });
  const profile = profileQuery.data;

  useEffect(() => {
    if (profile) setLang(fromServerLocale(profile.locale));
  }, [profile, setLang]);

  useRegisterPush(profile?.onboarded === true && profile.reminderTime !== null);

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  // Held until the profile says whether the first-run flow is due, so a new reader
  // never glimpses an empty Bugün first. A profile that fails to load lets the tabs open.
  if (profileQuery.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (profile && !profile.onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: hairline,
          height: 74,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: {
          fontFamily: 'Nunito_600SemiBold',
          fontSize: 11,
          // Turkish labels carry descenders and dotted capitals; the default line
          // height crops both.
          lineHeight: 15,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t.tabs.today, tabBarIcon: tabIcon('today', 'today-filled') }}
      />
      <Tabs.Screen
        name="shelf"
        options={{ title: t.tabs.shelf, tabBarIcon: tabIcon('shelf', 'shelf-filled') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t.tabs.profile, tabBarIcon: tabIcon('profile', 'profile-filled') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
