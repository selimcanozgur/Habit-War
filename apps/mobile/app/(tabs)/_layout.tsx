/**
 * Tab navigator.
 *
 * The five tabs the app is built around. Extracted from the root layout so the auth
 * group and the tab group can coexist as siblings under the Slot in _layout.tsx.
 *
 * The session gate in the root layout ensures this layout only mounts when a user
 * is present, so there is no need to repeat that check here.
 */

import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { Icon, type IconName } from '../../src/components/Icon';
import { colors } from '../../src/theme';

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

export default function TabsLayout(): React.JSX.Element {
  return (
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
  );
}
