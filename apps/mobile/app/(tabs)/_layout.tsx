/**
 * Tab navigator.
 *
 * The five tabs the app is built around. Extracted from the root layout so the auth
 * group and the tab group can coexist as siblings under the Slot in _layout.tsx.
 *
 * Signed-out users are sent to sign-in from here rather than from the root layout:
 * the root must keep rendering its Slot for the navigation to land.
 *
 * While a session runs, the running-session bar sits just above the tab bar on every
 * tab but Bugün — which already is the timer — and the screens leave room for it.
 */

import { Redirect, Tabs, usePathname } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { useAuth } from '../../src/auth/AuthContext';
import { Icon, type IconName } from '../../src/components/Icon';
import { RUNNING_BAR_HEIGHT, RunningSessionBar } from '../../src/components/RunningSessionBar';
import { useTimerStore } from '../../src/stores/timer';
import { colors, hairline } from '../../src/theme';

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

/** The tab bar's fixed height, set below; the running bar sits on top of it. */
const TAB_BAR_HEIGHT = 74;

export default function TabsLayout(): React.JSX.Element {
  const { user } = useAuth();
  const pathname = usePathname();
  const running = useTimerStore((state) => state.sessionId !== null);
  if (!user) return <Redirect href="/(auth)/sign-in" />;

  // Bugün is the timer itself while a session runs; the bar would repeat it.
  const showBar = running && pathname !== '/';

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: {
            backgroundColor: colors.bg,
            // Room for the bar, so the last row of a list never hides behind it.
            paddingBottom: showBar ? RUNNING_BAR_HEIGHT : 0,
          },
          tabBarStyle: {
            // White with a hairline, like the system bar: chrome that recedes so the
            // page is what the eye lands on.
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: hairline,
            // Tall enough for a 24px icon, its label, and breathing room above
            // the home indicator. At 62 the descenders in "Bugün" were clipped.
            height: TAB_BAR_HEIGHT,
            paddingTop: 8,
            paddingBottom: 12,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarLabelStyle: {
            fontFamily: 'Nunito_600SemiBold',
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
      {showBar && (
        <View style={styles.barSlot} pointerEvents="box-none">
          <RunningSessionBar />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  barSlot: { position: 'absolute', left: 0, right: 0, bottom: TAB_BAR_HEIGHT },
});
