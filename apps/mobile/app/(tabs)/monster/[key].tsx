/**
 * One monster's page (docs/game-design.md §5.5): what it is, where the story meets it,
 * what beats it, how long its fights take at one damage per second, and what beating
 * its boss earns. Unmet monsters show only that they are still ahead.
 */

import {
  CATEGORY_DEFAULT_STAT,
  FIGHTS_PER_CHAPTER,
  MONSTERS,
  WEAKNESS_DAMAGE_MULTIPLIER,
  fightMaxHp,
  isBossFight,
} from '@habitwar/domain';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getStory } from '../../../src/api/story';
import { BackLink } from '../../../src/components/BackLink';
import { cardStyle } from '../../../src/components/Button';
import { MonsterEmblem } from '../../../src/components/Emblems';
import { Group } from '../../../src/components/Group';
import { Icon } from '../../../src/components/Icon';
import { chapterContent } from '../../../src/story/content';
import { categoryLabels, colors, radius, spacing, statColors, statLabels, type } from '../../../src/theme';

function minutesLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}

export default function MonsterScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ key: string }>();
  const index = MONSTERS.findIndex((monster) => monster.key === params.key);
  const monster = MONSTERS[index] ?? MONSTERS[0];
  const chapter = (index >= 0 ? index : 0) + 1;
  const content = chapterContent(chapter);

  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const story = storyQuery.data?.story ?? null;
  const position = story?.position ?? null;
  const met = story !== null && (story.finished || (position !== null && chapter <= position.chapter));
  const done = story !== null && (story.finished || (position !== null && chapter < position.chapter));
  const fightsWon = done ? FIGHTS_PER_CHAPTER : position && chapter === position.chapter ? position.fight - 1 : 0;

  if (!monster) return <SafeAreaView style={styles.screen} />;

  const effective = Object.entries(CATEGORY_DEFAULT_STAT)
    .filter(([, stat]) => stat === monster.weakness)
    .map(([category]) => categoryLabels[category] ?? category)
    .join(', ');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label="Canavar Kitabı" href="/monsters" />

        <View style={styles.hero}>
          <MonsterEmblem monsterKey={monster.key} size={104} locked={!met} defeated={done} />
          <Text style={styles.name}>{met ? monster.name : '???'}</Text>
          <Text style={styles.where}>
            Bölüm {chapter} · {content.region}
          </Text>
          {met && <Text style={styles.tagline}>“{monster.tagline}”</Text>}
        </View>

        {!met ? (
          <View style={styles.card}>
            <Text style={styles.body}>Bu canavarla henüz karşılaşmadın. Hikayede ilerledikçe sayfası açılacak.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Hikayesi</Text>
              <Text style={styles.body}>{content.lore}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Zayıflığı</Text>
              <View style={styles.weakRow}>
                <View style={[styles.dot, { backgroundColor: statColors[monster.weakness] }]} />
                <Text style={[styles.weakStat, { color: statColors[monster.weakness] }]}>
                  {statLabels[monster.weakness]}
                </Text>
              </View>
              <Text style={styles.body}>
                {effective} alışkanlıkların bu canavara saniyede {WEAKNESS_DAMAGE_MULTIPLIER} hasar verir; diğer
                alışkanlıklar saniyede 1.
              </Text>
            </View>

            <Text style={styles.section}>Savaşlar</Text>
            <Group inset={spacing.md}>
              {Array.from({ length: FIGHTS_PER_CHAPTER }, (_, i) => {
                const fight = i + 1;
                const boss = isBossFight(fight);
                const hp = fightMaxHp(chapter, fight);
                const won = fight <= fightsWon;
                return (
                  <View key={fight} style={styles.fightRow}>
                    <Text style={[styles.fightName, boss && styles.bossName]}>
                      {boss ? `BOSS · ${monster.bossName}` : `Savaş ${fight}`}
                    </Text>
                    <Text style={styles.fightMeta}>
                      {minutesLabel(hp)} · {hp} can
                    </Text>
                    {won && <Icon name="check-circle-filled" size={18} color={colors.success} />}
                  </View>
                );
              })}
            </Group>

            <View style={styles.card}>
              <Text style={styles.label}>Ödül</Text>
              <View style={styles.weakRow}>
                <Icon name="trophy" size={18} color={colors.goldDark} />
                <Text style={styles.body}>
                  {done ? 'Kazandın: ' : 'Boss\'u yenince: '}
                  <Text style={styles.title}>{monster.title}</Text> unvanı
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => router.navigate(`/chapter/${chapter}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText}>Bölüm {chapter}'e git</Text>
              <Icon name="chevron-right" size={16} color={colors.accent} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  pressed: { opacity: 0.6 },

  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  name: { ...type.hero, color: colors.text, textAlign: 'center' },
  where: { ...type.label, color: colors.textMuted },
  tagline: { ...type.body, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center' },

  card: { ...cardStyle, gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },
  body: { ...type.body, color: colors.text, lineHeight: 21, flexShrink: 1 },
  section: { ...type.heading, color: colors.text, paddingHorizontal: spacing.xs },

  weakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  weakStat: { ...type.heading },
  title: { fontFamily: 'Nunito_800ExtraBold', color: colors.goldDark },

  fightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md },
  fightName: { ...type.label, color: colors.text, flex: 1 },
  bossName: { color: colors.danger },
  fightMeta: { ...type.caption, color: colors.textMuted },

  link: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  linkText: { ...type.label, color: colors.accent },
});
