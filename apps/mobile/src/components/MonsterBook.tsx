/**
 * The bestiary: every monster, by level.
 *
 * All twenty are shown from day one — the ones above the player's level locked, with
 * the level that opens them — because seeing what lies ahead is half of why a level
 * matters. Each row says what the monster is, how tough, what beats it, and what the
 * player has done to it so far.
 *
 * Switching hunts takes two taps when a hunt has progress: the damage dealt does not
 * travel to the new monster, and that should never happen by accident.
 *
 * Folded by default to what the player can hunt plus the next few ahead, so the book
 * does not push the rest of the screen out of reach; one row opens the whole thing.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Hunt, MonsterEntry } from '../api/monsters';
import { colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { ChipButton } from './Button';
import { Group } from './Group';
import { Icon } from './Icon';
import { monsterIcon } from './monsterArt';

const EMBLEM = 40;
/** Locked monsters shown while folded: enough to see what is next. */
const PREVIEW_LOCKED = 2;

export interface MonsterBookProps {
  readonly monsters: readonly MonsterEntry[];
  readonly active: Hunt | null;
  readonly busy?: boolean;
  readonly onHunt: (monsterKey: string) => void;
}

export function MonsterBook({ monsters, active, busy = false, onHunt }: MonsterBookProps): React.JSX.Element {
  const [armed, setArmed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hasProgress = active !== null && active.damage > 0;

  const unlockedCount = monsters.filter((monster) => monster.unlocked).length;
  const shown = expanded ? monsters : monsters.slice(0, unlockedCount + PREVIEW_LOCKED);
  const hidden = monsters.length - shown.length;

  return (
    <Group inset={spacing.md + EMBLEM + spacing.md}>
      {shown.map((monster) => {
        const hunting = active?.monster.key === monster.key;
        const locked = !monster.unlocked;
        return (
          <View key={monster.key} style={[styles.row, locked && styles.rowLocked]}>
            <View
              style={[
                styles.emblem,
                hunting && styles.emblemHunting,
                locked && styles.emblemLocked,
              ]}
            >
              <Icon
                name={locked ? 'lock' : monsterIcon(monster.key)}
                size={20}
                color={hunting ? colors.textOnDark : locked ? colors.textFaint : colors.text}
              />
            </View>

            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={1}>
                {monster.name}
              </Text>
              {locked ? (
                <Text style={styles.meta} numberOfLines={1}>
                  Seviye {monster.level} olunca açılır
                </Text>
              ) : (
                <>
                  <Text style={styles.meta} numberOfLines={1}>
                    {monster.conquered
                      ? `Fethedildi · ${monster.title}`
                      : monster.stage === monster.stages
                        ? `BOSS: ${monster.bossName}`
                        : `Seviye ${monster.stage}/${monster.stages}`}
                    {' · '}
                    <Text style={{ color: statColors[monster.weakness] }}>
                      {statLabels[monster.weakness]}
                    </Text>
                  </Text>
                  {/* The ladder: how far up this monster the player has climbed. */}
                  <View style={styles.ladder}>
                    <View
                      style={[
                        styles.ladderFill,
                        monster.conquered && styles.ladderFillDone,
                        { width: `${Math.round((Math.min(monster.defeats, monster.stages) / monster.stages) * 100)}%` },
                      ]}
                    />
                  </View>
                </>
              )}
            </View>

            {hunting ? (
              <Text style={styles.huntingTag}>Hedefin</Text>
            ) : locked ? (
              <Text style={styles.lockedTag}>Sv {monster.level}</Text>
            ) : monster.conquered && armed !== monster.key ? (
              <Icon name="trophy" size={20} color={colors.goldDark} />
            ) : armed === monster.key ? (
              <ChipButton
                label="Değiştir"
                tone="danger"
                disabled={busy}
                onPress={() => {
                  setArmed(null);
                  onHunt(monster.key);
                }}
                accessibilityLabel={`Mevcut avı bırak ve ${monster.name} avına başla`}
              />
            ) : (
              <ChipButton
                label="Avla"
                tone="neutral"
                disabled={busy}
                onPress={() => (hasProgress ? setArmed(monster.key) : onHunt(monster.key))}
                accessibilityLabel={`${monster.name} avına başla`}
              />
            )}
          </View>
        );
      })}
      {(hidden > 0 || expanded) && (
        <Pressable
          key="toggle"
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
        >
          <Text style={styles.toggleText}>
            {expanded ? 'Kitabı daralt' : `Tüm kitabı göster (${hidden} canavar daha)`}
          </Text>
        </Pressable>
      )}
    </Group>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.md,
  },
  rowLocked: { opacity: 0.65 },
  emblem: {
    width: EMBLEM,
    height: EMBLEM,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemHunting: { backgroundColor: colors.stone },
  emblemLocked: { backgroundColor: colors.surfaceRaised },
  text: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },
  huntingTag: { ...type.label, color: colors.danger },
  ladder: {
    height: 4,
    marginTop: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  ladderFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  ladderFillDone: { backgroundColor: colors.gold },
  lockedTag: { ...type.label, color: colors.textFaint },
  toggle: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  togglePressed: { backgroundColor: colors.surfaceRaised },
  toggleText: { ...type.label, color: colors.accent },
});
