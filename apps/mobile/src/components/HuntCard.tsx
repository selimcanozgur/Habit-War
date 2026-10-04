/**
 * The hunt under way.
 *
 * The game moment of the app, so it gets more presence than a list card: a large
 * emblem, the HP bar, and — the part that turns it into a plan — which of the user's
 * habits hit it hardest. Every completed session hits it; the weak stat's habits hit
 * half again as hard.
 *
 * The fight itself is a habit session: "Savaşa başla" lists the player's habits —
 * the ones that hit the weakness first — and picking one starts its timer, where the
 * monster's HP drains live as the minutes run. There is no separate game to play; the
 * card is the way into the real thing.
 */

import {
  CATEGORY_DEFAULT_STAT,
  MONSTER_WEAKNESS_MULTIPLIER,
  resolveStat,
  type Category,
  type Stat,
} from '@habitwar/domain';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Hunt } from '../api/monsters';
import type { Habit } from '../api/sessions';
import { categoryLabels, colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { Button, cardStyle } from './Button';
import { CATEGORY_ICONS, Icon } from './Icon';
import { monsterIcon } from './monsterArt';

/** The first category whose habits train a stat by default. */
function categoryForStat(stat: Stat): Category | undefined {
  return (Object.entries(CATEGORY_DEFAULT_STAT) as [Category, Stat][]).find(([, value]) => value === stat)?.[0];
}

/** Category names whose habits train a stat by default — "Spor", "Ders"… */
export function categoriesFor(stat: Stat): string {
  return Object.entries(CATEGORY_DEFAULT_STAT)
    .filter(([, value]) => value === stat)
    .map(([category]) => categoryLabels[category] ?? category)
    .join(', ');
}

export interface HuntCardProps {
  readonly hunt: Hunt;
  /** The player's habits, to fight with. */
  readonly habits: readonly Habit[];
  /** A session is already running: the button returns to it instead of starting one. */
  readonly sessionRunning: boolean;
  readonly busy?: boolean;
  readonly onFight: (habitId: string) => void;
  readonly onResume: () => void;
  /** Opens the habit catalog; with a category, its group leads. */
  readonly onAddHabit: (category?: Category) => void;
}

export function HuntCard({
  hunt,
  habits,
  sessionRunning,
  busy = false,
  onFight,
  onResume,
  onAddHabit,
}: HuntCardProps): React.JSX.Element {
  const [picking, setPicking] = useState(false);
  const { monster } = hunt;
  // Weakness first: the habits that hit hardest are the ones worth suggesting.
  const fighters = [...habits]
    .map((habit) => ({ habit, weak: resolveStat(habit.category, habit.stat) === monster.weakness }))
    .sort((a, b) => Number(b.weak) - Number(a.weak));
  const tint = statColors[monster.weakness];
  const ratio = hunt.maxHp > 0 ? Math.min(1, hunt.hp / hunt.maxHp) : 0;
  const recent = hunt.hits.slice(0, 3);

  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.emblem, hunt.isBoss && styles.emblemBoss]}>
          <Icon
            name={monsterIcon(monster.key)}
            size={30}
            color={hunt.isBoss ? colors.gold : colors.textOnDark}
          />
        </View>
        <View style={styles.identity}>
          <View style={styles.overlineRow}>
            {hunt.isBoss && <Text style={styles.bossBadge}>BOSS</Text>}
            <Text style={styles.overline}>
              Avın · Seviye {hunt.stage}/{monster.stages}
            </Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {hunt.name}
          </Text>
          <Text style={styles.tagline} numberOfLines={2}>
            {monster.tagline}
          </Text>
        </View>
      </View>

      <View
        style={styles.hpBlock}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${monster.name}: ${hunt.hp} / ${hunt.maxHp} can`}
      >
        <View style={styles.hpTrack}>
          <View style={[styles.hpFill, { width: `${Math.round(ratio * 100)}%` }]} />
        </View>
        <View style={styles.hpRow}>
          <Text style={styles.hpText}>
            Can: {hunt.hp} / {hunt.maxHp}
          </Text>
          <Text style={styles.meta}>
            {hunt.isBoss
              ? `Ödül: ${monster.title} unvanı`
              : hunt.stage === monster.stages - 1
                ? `Sıradaki: ${monster.bossName}`
                : `Sıradaki: Seviye ${hunt.stage + 1}`}
          </Text>
        </View>
      </View>

      <View style={styles.weakness}>
        <View style={[styles.weaknessDot, { backgroundColor: tint }]} />
        <Text style={styles.weaknessText}>
          Zayıflığı <Text style={[styles.weaknessStat, { color: tint }]}>{statLabels[monster.weakness]}</Text>
          {' — '}
          {categoriesFor(monster.weakness)} alışkanlıkların ×{MONSTER_WEAKNESS_MULTIPLIER} vurur.
        </Text>
      </View>

      {/* The way in: start a session against this monster. */}
      {sessionRunning ? (
        <Button label="Savaşa dön" onPress={onResume} accessibilityLabel="Süren savaşa dön" />
      ) : !picking ? (
        <Button
          label="Savaşa başla"
          onPress={() => (habits.length === 0 ? onAddHabit() : setPicking(true))}
          accessibilityLabel={`${hunt.name} ile savaşa başla`}
        />
      ) : (
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Hangi alışkanlıkla savaşacaksın?</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Vazgeç">
              <Icon name="x" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          {/* Nothing that hits the weakness yet: point at the catalog's group for it. */}
          {!fighters.some((item) => item.weak) && (
            <Pressable
              onPress={() => {
                setPicking(false);
                onAddHabit(categoryForStat(monster.weakness));
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.suggest, pressed && styles.fighterPressed]}
            >
              <Icon name="plus" size={16} color={tint} />
              <Text style={[styles.suggestText, { color: tint }]}>
                Zayıflığına uygun hazır alışkanlık ekle ({statLabels[monster.weakness]} ×{MONSTER_WEAKNESS_MULTIPLIER})
              </Text>
            </Pressable>
          )}
          {fighters.map(({ habit, weak }) => (
            <Pressable
              key={habit.id}
              disabled={busy}
              onPress={() => {
                setPicking(false);
                onFight(habit.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${habit.name} ile savaş${weak ? ', zayıf noktasına vurur' : ''}`}
              style={({ pressed }) => [styles.fighter, pressed && styles.fighterPressed]}
            >
              <Icon name={CATEGORY_ICONS[habit.category] ?? 'play'} size={18} color={colors.textMuted} />
              <Text style={styles.fighterName} numberOfLines={1}>
                {habit.name}
              </Text>
              {weak && (
                <Text style={[styles.crit, { color: tint }]}>×{MONSTER_WEAKNESS_MULTIPLIER} zayıf nokta</Text>
              )}
              <Icon name="play-filled" size={20} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      )}

      {recent.length > 0 ? (
        <View style={styles.hits}>
          <Text style={styles.hitsTitle}>Toplam {hunt.damage} hasar verdin</Text>
          {recent.map((hit) => (
            <View key={hit.sessionId} style={styles.hitRow}>
              <Icon name="swords" size={14} color={colors.textFaint} />
              <Text style={styles.hitName} numberOfLines={1}>
                {hit.habitName}
              </Text>
              {hit.weakness && (
                <Text style={[styles.crit, { color: tint }]}>×{MONSTER_WEAKNESS_MULTIPLIER}</Text>
              )}
              <Text style={styles.hitDamage}>−{hit.damage}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          Bir alışkanlık seansı tamamla — kazandığın XP kadar hasar verir.
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emblem: {
    width: 60,
    height: 60,
    borderRadius: radius.md + 2,
    backgroundColor: colors.stone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The boss earns the one gold edge on the screen.
  emblemBoss: { borderWidth: 2, borderColor: colors.gold },
  identity: { flex: 1, gap: 2 },
  overlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  overline: { ...type.caption, color: colors.textMuted },
  bossBadge: {
    ...type.caption,
    fontFamily: 'Nunito_800ExtraBold',
    color: colors.textOnAccent,
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: radius.sm - 4,
    overflow: 'hidden',
  },
  name: { ...type.title, color: colors.text },
  tagline: { ...type.caption, color: colors.textMuted },

  hpBlock: { gap: spacing.xs },
  hpTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  // Danger red: this bar going down is the good news.
  hpFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  hpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  hpText: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'] },
  meta: { ...type.caption, color: colors.goldDark, flexShrink: 1, textAlign: 'right' },

  weakness: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  weaknessDot: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 5 },
  weaknessText: { ...type.caption, color: colors.textMuted, flex: 1, lineHeight: 17 },
  weaknessStat: { fontFamily: 'Nunito_800ExtraBold' },

  hits: { gap: spacing.xs },
  hitsTitle: { ...type.label, color: colors.textMuted },
  hitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hitName: { ...type.body, color: colors.text, flex: 1 },
  crit: { ...type.caption, fontFamily: 'Nunito_800ExtraBold' },
  hitDamage: { ...type.label, color: colors.danger, fontVariant: ['tabular-nums'] },
  empty: { ...type.caption, color: colors.textFaint },

  picker: { gap: spacing.xs },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerTitle: { ...type.label, color: colors.text },
  fighter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  fighterPressed: { opacity: 0.7 },
  fighterName: { ...type.body, color: colors.text, flex: 1 },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  suggestText: { ...type.label, flex: 1 },
});
