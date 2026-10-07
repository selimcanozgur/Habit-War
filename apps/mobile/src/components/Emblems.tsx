/**
 * The two fighters, drawn as emblems until the story gets its illustrations
 * (docs/art-prompts.md). The key is the stable link to the art that will replace them.
 *
 *  - MonsterEmblem: the monster's icon on dark stone; a boss wears a gold edge.
 *  - PlayerEmblem: the Spark Bearer — the willpower spark in their hand.
 *  - FocusBar: the player's four-step focus, the XP focus multiplier made visible.
 */

import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius } from '../theme';
import { Icon } from './Icon';
import { monsterIcon } from './monsterArt';

export function MonsterEmblem({
  monsterKey,
  size = 56,
  boss = false,
  locked = false,
  defeated = false,
  onDark = false,
  style,
}: {
  readonly monsterKey: string;
  readonly size?: number;
  readonly boss?: boolean;
  readonly locked?: boolean;
  readonly defeated?: boolean;
  /** On a dark ground (the arena, the VS screen): a lighter tile so the edge reads. */
  readonly onDark?: boolean;
  readonly style?: ViewStyle;
}): React.JSX.Element {
  return (
    <View
      style={[
        styles.emblem,
        { width: size, height: size, borderRadius: size * 0.24 },
        onDark && styles.onDark,
        boss && styles.boss,
        defeated && styles.defeated,
        locked && styles.locked,
        style,
      ]}
    >
      <Icon
        name={locked ? 'lock' : monsterIcon(monsterKey)}
        size={Math.round(size * 0.5)}
        color={locked ? colors.textFaint : defeated ? colors.goldDark : boss ? colors.gold : colors.textOnDark}
      />
    </View>
  );
}

export function PlayerEmblem({ size = 56, style }: { readonly size?: number; readonly style?: ViewStyle }): React.JSX.Element {
  return (
    <View style={[styles.player, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <Icon name="flame-filled" size={Math.round(size * 0.5)} color={colors.gold} />
    </View>
  );
}

/** Four steps, 4 = uninterrupted. Never drawn empty: focus costs XP bonus, not the fight. */
export function FocusBar({ level, onDark = false }: { readonly level: number; readonly onDark?: boolean }): React.JSX.Element {
  return (
    <View style={styles.focus} accessible accessibilityLabel={`Odak ${level} / 4`}>
      {[1, 2, 3, 4].map((step) => (
        <View
          key={step}
          style={[
            styles.focusStep,
            onDark && styles.focusStepOnDark,
            step <= level && (level === 4 ? styles.focusFull : styles.focusOn),
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emblem: {
    backgroundColor: colors.stone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The boss earns the one gold edge on the screen.
  onDark: { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  boss: { borderWidth: 2, borderColor: colors.gold },
  defeated: { backgroundColor: colors.goldSoft },
  locked: { backgroundColor: colors.surfaceRaised },
  player: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.gold,
  },
  focus: { flexDirection: 'row', gap: 3 },
  focusStep: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  focusStepOnDark: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  focusOn: { backgroundColor: colors.fire },
  focusFull: { backgroundColor: colors.success },
});
