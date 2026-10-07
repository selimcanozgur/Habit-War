/**
 * Bugün's mission card: the fight under way and the one thing to do about it.
 *
 * A player opening the app should not have to work out what to do. The card says who
 * they are fighting, how much of it is left, and offers one button — the best habit to
 * fight with right now (not yet done today, the weakness first) with how long the fight
 * will take. Işıl adds one line for the moment: a boss ahead, a monster nearly down, a
 * streak to keep. Any other habit is one tap further, behind "Başka alışkanlık".
 */

import { FIGHTS_PER_CHAPTER, WEAKNESS_DAMAGE_MULTIPLIER, type Category } from '@habitwar/domain';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Habit } from '../api/sessions';
import type { CurrentFight } from '../api/story';
import { chapterContent } from '../story/content';
import { fightTimeLabel, rankFighters, type Fighter } from '../story/fighters';
import { colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { Button, cardStyle } from './Button';
import { MonsterEmblem } from './Emblems';
import { categoryForStat, FightPicker } from './FightPicker';
import { Icon } from './Icon';

/** Below this share of its HP a monster is "nearly down" — the line that pulls a player back. */
const NEARLY_DOWN = 0.25;

export interface MissionCardProps {
  readonly fight: CurrentFight;
  readonly habits: readonly Habit[];
  readonly today: string;
  /** Habits done today, of `total`. */
  readonly doneToday: number;
  readonly total: number;
  readonly dayStreak: number;
  readonly busy: boolean;
  readonly onFight: (habitId: string) => void;
  /** Opens the habit catalog, with a group in front when one is given. */
  readonly onAddHabit: (category?: Category) => void;
}

/** Işıl's one line for this moment. The first that applies wins. */
function isilLine(
  fight: CurrentFight,
  top: Fighter | null,
  doneToday: number,
  total: number,
  dayStreak: number,
): string {
  if (!top) {
    return `${fight.name} süreli alışkanlıklarla yenilir. Bir tane ekle, hemen savaşa başlayalım.`;
  }
  const time = fightTimeLabel(fight.hp, top.rate);
  if (fight.isBoss) {
    return `Boss savaşı! ${fight.name} bu bölgenin son engeli. Yenersen yeni bir bölge açılır.`;
  }
  if (fight.hp <= fight.maxHp * NEARLY_DOWN) {
    return `Az kaldı! ${fight.name} son ${fight.hp} canında. ${time} çalışman yeter.`;
  }
  if (doneToday === 0 && dayStreak > 0) {
    return `${dayStreak} günlük serin var. Bugün bir seans yap, seri devam etsin!`;
  }
  if (doneToday === 0) {
    return `Bugün ilk darbeyi vur: ${time} çalışırsan ${fight.name} düşer.`;
  }
  if (total > 0 && doneToday >= total) {
    return `Bugünkü listen tamam, harikasın! ${fight.name} yine de seni bekliyor.`;
  }
  if (!top.weak) {
    return `${fight.name}, ${statLabels[fight.weakness]} alışkanlıklarına zayıf: onlar ×${WEAKNESS_DAMAGE_MULTIPLIER} vurur.`;
  }
  return `${top.habit.name}, zayıf noktasına vurur. ${time} çalışman yeter.`;
}

export function MissionCard({
  fight,
  habits,
  today,
  doneToday,
  total,
  dayStreak,
  busy,
  onFight,
  onAddHabit,
}: MissionCardProps): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const fighters = rankFighters(habits, fight.weakness, today);
  const top = fighters[0] ?? null;
  const ratio = fight.maxHp > 0 ? fight.hp / fight.maxHp : 0;

  return (
    <View style={styles.card}>
      {/* ------------------------------------------------------- the monster */}
      <Pressable
        onPress={() => router.navigate(`/chapter/${fight.chapter}`)}
        accessibilityRole="button"
        accessibilityLabel={`Bölüm ${fight.chapter}: ${fight.name}, ${fight.hp} can kaldı. Bölümü aç.`}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        <MonsterEmblem monsterKey={fight.monsterKey} size={52} boss={fight.isBoss} />
        <View style={styles.headText}>
          <Text style={styles.meta} numberOfLines={1}>
            Bölüm {fight.chapter} · {chapterContent(fight.chapter).region}
            {fight.isBoss ? '' : ` · Savaş ${fight.fight}/${FIGHTS_PER_CHAPTER - 1}`}
          </Text>
          {fight.isBoss && <Text style={styles.tagBoss}>BOSS</Text>}
          <Text style={styles.name} numberOfLines={2}>
            {fight.name}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
          <Text style={styles.hp}>
            {fight.hp} / {fight.maxHp} can
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.textFaint} />
      </Pressable>

      {/* ------------------------------------------------------- Işıl's line */}
      <View style={styles.isil}>
        <View style={styles.isilDisc}>
          <Icon name="flame-filled" size={14} color={colors.fire} />
        </View>
        <Text style={styles.isilText}>{isilLine(fight, top, doneToday, total, dayStreak)}</Text>
      </View>

      {/* ------------------------------------------------------- the action */}
      {top ? (
        <View style={styles.action}>
          <Button
            label={`${top.habit.name} ile savaş`}
            disabled={busy}
            onPress={() => onFight(top.habit.id)}
            accessibilityLabel={`${top.habit.name} ile savaşa başla`}
          />
          <View style={styles.actionFoot}>
            <Text style={styles.estimate}>
              Tahmini süre: {fightTimeLabel(fight.hp, top.rate)}
              {top.weak ? (
                <Text style={{ color: statColors[fight.weakness] }}>
                  {' '}
                  · ×{WEAKNESS_DAMAGE_MULTIPLIER} zayıf nokta
                </Text>
              ) : null}
            </Text>
            <Pressable
              onPress={() => setPicking((value) => !value)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ expanded: picking }}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.other}>{picking ? 'Kapat' : 'Başka alışkanlık'}</Text>
            </Pressable>
          </View>
          {picking && (
            <FightPicker
              habits={habits}
              weakness={fight.weakness}
              busy={busy}
              onPick={onFight}
              onAddHabit={onAddHabit}
            />
          )}
        </View>
      ) : (
        <Button
          label="Savaşmak için alışkanlık ekle"
          onPress={() => onAddHabit(categoryForStat(fight.weakness))}
          accessibilityLabel="Savaşmak için alışkanlık ekle"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.md },
  pressed: { opacity: 0.6 },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 3 },
  meta: { ...type.caption, color: colors.textMuted },
  name: { ...type.title, color: colors.text },
  tagBoss: {
    ...type.caption,
    alignSelf: 'flex-start',
    fontFamily: 'Nunito_800ExtraBold',
    color: colors.textOnAccent,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    overflow: 'hidden',
  },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  hp: { ...type.caption, color: colors.danger, fontVariant: ['tabular-nums'] },

  isil: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.fireSoft,
  },
  isilDisc: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  isilText: { ...type.body, color: colors.text, flex: 1, lineHeight: 21 },

  action: { gap: spacing.sm },
  actionFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  estimate: { ...type.caption, color: colors.textMuted, flexShrink: 1 },
  other: { ...type.label, color: colors.accent },
});
