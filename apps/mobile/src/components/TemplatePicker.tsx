/**
 * The catalog of ready-made habits, grouped by the stat they train — which is to say,
 * by the monsters they hit hardest.
 *
 * The group that hits the player's current target leads, labelled with the monster,
 * because "which habit beats this one" is the question the player arrives with. Adding
 * is one tap and the sheet stays open, so a new player can pick three habits in three
 * taps; added ones turn into a check rather than disappearing, so nothing jumps.
 */

import {
  CATEGORY_DEFAULT_STAT,
  MONSTERS,
  WEAKNESS_DAMAGE_MULTIPLIER,
  type Stat,
} from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { getStory } from '../api/story';
import { createHabit, listHabits } from '../api/sessions';
import { HABIT_TEMPLATES, templateHabitInput, type HabitTemplate } from '../habitTemplates';
import { categoryColors, colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { ChipButton } from './Button';
import { CATEGORY_ICONS, Icon } from './Icon';

/** Stats a habit can train by default, in the order the groups appear. */
const STAT_ORDER: readonly Stat[] = ['STR', 'INT', 'WIS', 'DEX', 'CHA'];

function statOf(template: HabitTemplate): Stat {
  return CATEGORY_DEFAULT_STAT[template.category];
}

/** "Uyuşukluk Balçığı, Erteleme Golemi" — the first monsters weak to a stat. */
function monstersWeakTo(stat: Stat): string {
  return MONSTERS.filter((monster) => monster.weakness === stat)
    .slice(0, 2)
    .map((monster) => monster.name)
    .join(', ');
}

function describe(template: HabitTemplate): string {
  return template.kind === 'COUNT'
    ? `Sayılı · günde ${template.targetCount} ${template.unit}`
    : `Süreli · günde ${template.targetMinutes} dk`;
}

export interface TemplatePickerProps {
  /** A stat to lead with — e.g. a duel's or the hunted monster's weakness. */
  readonly focusStat?: Stat | null;
  readonly onCustom: () => void;
}

export function TemplatePicker({ focusStat = null, onCustom }: TemplatePickerProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const hunt = storyQuery.data?.story.current ?? null;
  const lead = focusStat ?? hunt?.weakness ?? null;
  const owned = new Set((habitsQuery.data?.habits ?? []).map((habit) => habit.name.toLocaleLowerCase('tr-TR')));
  const order = lead ? [lead, ...STAT_ORDER.filter((stat) => stat !== lead)] : STAT_ORDER;

  const mutation = useMutation({
    mutationFn: (template: HabitTemplate) => createHabit(templateHabitInput(template)),
    onMutate: (template) => {
      setAdding(template.key);
      setError(null);
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError && err.code !== 'NETWORK' ? err.message : 'Sunucuya ulaşılamadı.'),
    onSettled: () => setAdding(null),
  });

  return (
    <View style={styles.wrap}>
      {order.map((stat) => {
        const templates = HABIT_TEMPLATES.filter((template) => statOf(template) === stat);
        if (templates.length === 0) return null;
        const leading = stat === lead;
        return (
          <View key={stat} style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={[styles.dot, { backgroundColor: statColors[stat] }]} />
              <Text style={styles.groupTitle}>{statLabels[stat]}</Text>
              <Text style={[styles.groupHint, leading && styles.groupHintLead]} numberOfLines={1}>
                {leading && hunt
                  // No case suffix on the name: Turkish vowel harmony would need one per monster.
                  ? `×${WEAKNESS_DAMAGE_MULTIPLIER} vurur · hedefin ${hunt.name}`
                  : `Güçlü: ${monstersWeakTo(stat)}`}
              </Text>
            </View>
            {templates.map((template) => {
              const have = owned.has(template.name.toLocaleLowerCase('tr-TR'));
              return (
                <View key={template.key} style={styles.row}>
                  <View style={[styles.icon, { backgroundColor: categoryColors[template.category] }]}>
                    <Icon
                      name={CATEGORY_ICONS[template.category] ?? 'play'}
                      size={16}
                      color={colors.textOnAccent}
                    />
                  </View>
                  <View style={styles.text}>
                    <Text style={styles.name} numberOfLines={1}>
                      {template.name}
                    </Text>
                    <Text style={styles.meta}>{describe(template)}</Text>
                  </View>
                  {have ? (
                    <Icon name="check-circle-filled" size={22} color={colors.success} />
                  ) : (
                    <ChipButton
                      label={adding === template.key ? '…' : 'Ekle'}
                      tone="neutral"
                      disabled={mutation.isPending}
                      onPress={() => mutation.mutate(template)}
                      accessibilityLabel={`${template.name} alışkanlığını ekle`}
                    />
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={onCustom}
        accessibilityRole="button"
        style={({ pressed }) => [styles.custom, pressed && styles.pressed]}
      >
        <Icon name="plus" size={16} color={colors.accent} />
        <Text style={styles.customText}>Kendi alışkanlığını oluştur</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xs },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  groupTitle: { ...type.label, color: colors.text },
  groupHint: { ...type.caption, color: colors.textFaint, flex: 1, textAlign: 'right' },
  groupHintLead: { color: colors.danger, fontFamily: 'Nunito_800ExtraBold' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 1 },
  name: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.danger },
  custom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  pressed: { opacity: 0.6 },
  customText: { ...type.label, color: colors.accent },
});
