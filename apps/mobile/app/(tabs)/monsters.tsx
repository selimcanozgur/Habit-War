/**
 * The monster book (docs/game-design.md §5.5): every monster of the story, in chapter
 * order. Those the road has reached are open — named, with their chapter — and the
 * rest stay "???" until met, so the book fills as the story is played.
 */

import { MONSTERS } from '@habitwar/domain';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getStory } from '../../src/api/story';
import { BackLink } from '../../src/components/BackLink';
import { MonsterEmblem } from '../../src/components/Emblems';
import { chapterContent } from '../../src/story/content';
import { colors, radius, spacing, type } from '../../src/theme';

export default function MonstersScreen(): React.JSX.Element {
  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const story = storyQuery.data?.story ?? null;
  const reached = story ? (story.finished ? MONSTERS.length : story.position.chapter) : 0;
  const beaten = story ? (story.finished ? MONSTERS.length : story.position.chapter - 1) : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label="Hikaye" href="/story" />
        <Text style={styles.title}>Canavar Kitabı</Text>
        <Text style={styles.subtitle}>
          {reached} / {MONSTERS.length} canavarla karşılaştın · {beaten} bölge kurtarıldı
        </Text>

        <View style={styles.grid}>
          {MONSTERS.map((monster, index) => {
            const chapter = index + 1;
            const met = chapter <= reached;
            const won = chapter <= beaten;
            return (
              <Pressable
                key={monster.key}
                disabled={!met}
                onPress={() => router.navigate(`/monster/${monster.key}`)}
                accessibilityRole="button"
                accessibilityLabel={met ? monster.name : `Bölüm ${chapter}, henüz karşılaşılmadı`}
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
              >
                <MonsterEmblem monsterKey={monster.key} size={56} locked={!met} defeated={won} />
                <Text style={[styles.name, !met && styles.faint]} numberOfLines={2}>
                  {met ? monster.name : '???'}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  Bölüm {chapter} · {chapterContent(chapter).region}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  title: { ...type.hero, color: colors.text },
  subtitle: { ...type.caption, color: colors.textMuted, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    width: '31.5%',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  name: { ...type.label, color: colors.text, textAlign: 'center' },
  faint: { color: colors.textFaint },
  meta: { ...type.caption, color: colors.textFaint, textAlign: 'center', fontSize: 10 },
});
