/**
 * The versus intro (docs/game-design.md §5.2): the player on the left, the monster on
 * the right, a big VS between them — two and a half seconds that turn starting a habit
 * into stepping into a fight. Plays once per session started from a tap, closes by
 * itself, and a tap skips it.
 */

import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight, ZoomIn } from 'react-native-reanimated';

import type { CurrentFight } from '../api/story';
import { FIGHTS_PER_CHAPTER } from '@habitwar/domain';
import { chapterContent } from '../story/content';
import { colors, radius, spacing, type } from '../theme';
import { FocusBar, MonsterEmblem, PlayerEmblem } from './Emblems';

/** Long enough to read both names, short enough not to stand between a user and work. */
const INTRO_MS = 2600;

export interface VersusIntroProps {
  readonly fight: CurrentFight;
  readonly playerName: string;
  readonly playerLevel: number;
  readonly playerTitle: string | null;
  readonly onDone: () => void;
}

export function VersusIntro({
  fight,
  playerName,
  playerLevel,
  playerTitle,
  onDone,
}: VersusIntroProps): React.JSX.Element {
  useEffect(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const id = setTimeout(onDone, INTRO_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  const ratio = fight.maxHp > 0 ? fight.hp / fight.maxHp : 0;

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(200)} style={styles.overlay}>
      <Pressable style={styles.fill} onPress={onDone} accessibilityRole="button" accessibilityLabel="Savaşa geç">
        <Text style={styles.chapter}>
          Bölüm {fight.chapter} · {chapterContent(fight.chapter).region}
        </Text>

        <View style={styles.arena}>
          <Animated.View entering={SlideInLeft.duration(380).springify()} style={styles.side}>
            <PlayerEmblem size={96} />
            <Text style={styles.name} numberOfLines={2}>
              {playerName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              Seviye {playerLevel}
              {playerTitle ? ` · ${playerTitle}` : ''}
            </Text>
            <View style={styles.bar}>
              <FocusBar level={4} onDark />
            </View>
            <Text style={styles.barLabel}>Odak</Text>
          </Animated.View>

          <Animated.Text entering={ZoomIn.delay(250).duration(300).springify()} style={styles.vs}>
            VS
          </Animated.Text>

          <Animated.View entering={SlideInRight.duration(380).springify()} style={styles.side}>
            <MonsterEmblem monsterKey={fight.monsterKey} size={96} boss={fight.isBoss} onDark />
            <Text style={styles.name} numberOfLines={2}>
              {fight.name}
            </Text>
            <Text style={[styles.meta, fight.isBoss && styles.bossMeta]} numberOfLines={1}>
              {fight.isBoss ? 'BOSS' : `Savaş ${fight.fight}/${FIGHTS_PER_CHAPTER - 1}`}
            </Text>
            <View style={styles.bar}>
              <View style={styles.hpTrack}>
                <View style={[styles.hpFill, { width: `${Math.round(ratio * 100)}%` }]} />
              </View>
            </View>
            <Text style={styles.barLabel}>
              Can {fight.hp} / {fight.maxHp}
            </Text>
          </Animated.View>
        </View>

        {fight.isBoss && (
          <Animated.Text entering={FadeIn.delay(600).duration(300)} style={styles.bossLine}>
            “{chapterContent(fight.chapter).bossLine}”
          </Animated.Text>
        )}

        <Text style={styles.hint}>Her saniye bir darbe. Geçmek için dokun.</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.stone, zIndex: 20 },
  fill: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.xl },
  chapter: { ...type.label, color: colors.textOnDarkMuted, textAlign: 'center' },
  arena: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  side: { flex: 1, alignItems: 'center', gap: spacing.xs },
  name: { ...type.title, color: colors.textOnDark, textAlign: 'center' },
  meta: { ...type.caption, color: colors.textOnDarkMuted, textAlign: 'center' },
  bossMeta: { color: colors.danger, fontFamily: 'Nunito_800ExtraBold' },
  bar: { alignSelf: 'stretch', marginTop: spacing.sm },
  barLabel: { ...type.caption, color: colors.textOnDarkMuted },
  hpTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  hpFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  vs: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 44,
    color: colors.gold,
    letterSpacing: 2,
  },
  bossLine: { ...type.body, color: colors.textOnDark, textAlign: 'center', fontStyle: 'italic' },
  hint: { ...type.caption, color: colors.textOnDarkMuted, textAlign: 'center' },
});
