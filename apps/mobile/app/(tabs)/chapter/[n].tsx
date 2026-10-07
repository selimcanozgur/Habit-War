/**
 * A chapter page (docs/game-design.md §3.3, §5.4): the region, Işıl's opening scene,
 * the four stops — three fights and the boss — and, for the chapter under way, the way
 * into the next fight. A finished chapter adds the boss's challenge and the ending.
 */

import {
  FIGHTS_PER_CHAPTER,
  STORY_CHAPTERS,
  chapterBaseMinutes,
  chapterMonster,
  fightMaxHp,
  isBossFight,
} from '@habitwar/domain';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../../../src/api/client';
import { listHabits } from '../../../src/api/sessions';
import { getStory } from '../../../src/api/story';
import { BackLink } from '../../../src/components/BackLink';
import { Button, cardStyle } from '../../../src/components/Button';
import { MonsterEmblem } from '../../../src/components/Emblems';
import { FightPicker } from '../../../src/components/FightPicker';
import { Group } from '../../../src/components/Group';
import { Icon } from '../../../src/components/Icon';
import { useTimerStore } from '../../../src/stores/timer';
import { chapterContent } from '../../../src/story/content';
import { fightTimeLabel } from '../../../src/story/fighters';
import { useStartFight } from '../../../src/story/useStartFight';
import { colors, radius, spacing, statColors, statLabels, type } from '../../../src/theme';

export default function ChapterScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ n: string }>();
  const chapter = Math.min(STORY_CHAPTERS, Math.max(1, Number(params.n) || 1));
  const monster = chapterMonster(chapter);
  const content = chapterContent(chapter);

  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const sessionRunning = useTimerStore((state) => state.sessionId !== null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartFight((err) =>
    setError(err instanceof ApiError && err.code !== 'NETWORK' ? err.message : 'Sunucuya ulaşılamadı.'),
  );

  const story = storyQuery.data?.story ?? null;
  const position = story?.position ?? null;
  const done = story !== null && position !== null && (story.finished || chapter < position.chapter);
  const current = position !== null && !done && chapter === position.chapter;
  const locked = position !== null && !done && !current;
  const fightNow = current && position ? position.fight : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BackLink label="Hikaye" href="/story" />

        {/* ---------------------------------------------------------------- header */}
        <View style={styles.header}>
          <MonsterEmblem
            monsterKey={monster.key}
            size={72}
            boss={current && isBossFight(fightNow)}
            defeated={done}
            locked={locked}
          />
          <View style={styles.headerText}>
            <Text style={styles.overline}>Bölüm {chapter}</Text>
            <Text style={styles.region}>{content.region}</Text>
            <Text style={styles.monsterName}>{locked ? '???' : monster.name}</Text>
          </View>
        </View>

        {storyQuery.isPending && <ActivityIndicator color={colors.accent} />}

        {locked ? (
          <View style={styles.card}>
            <Icon name="lock" size={20} color={colors.textFaint} />
            <Text style={styles.muted}>
              Bu bölüm, önceki bölümün boss'u yenilince açılır.
            </Text>
          </View>
        ) : (
          <>
            {/* ------------------------------------------------------ the opening */}
            <Speech text={content.intro} />

            {/* --------------------------------------------------------- the stops */}
            <Text style={styles.section}>Savaşlar</Text>
            <Group inset={spacing.md + 32 + spacing.md}>
              {Array.from({ length: FIGHTS_PER_CHAPTER }, (_, index) => {
                const fight = index + 1;
                const boss = isBossFight(fight);
                const maxHp = fightMaxHp(chapter, fight);
                const won = done || (current && fight < fightNow);
                const now = current && fight === fightNow;
                const hp = now && position ? maxHp - position.damage : maxHp;
                return (
                  <View key={fight} style={styles.stop}>
                    <View style={[styles.stopIcon, won && styles.stopIconWon, now && styles.stopIconNow]}>
                      <Icon
                        name={won ? 'check-circle-filled' : boss ? 'trophy' : 'swords'}
                        size={16}
                        color={won ? colors.success : now ? colors.textOnAccent : colors.textFaint}
                      />
                    </View>
                    <View style={styles.stopText}>
                      <Text style={styles.stopName}>
                        {boss ? `BOSS · ${monster.bossName}` : `Savaş ${fight} · ${monster.name}`}
                      </Text>
                      <Text style={styles.stopMeta}>
                        {fightTimeLabel(maxHp, 1)} · {maxHp} can
                        {now ? ` · ${hp} kaldı` : ''}
                      </Text>
                      {now && (
                        <View style={styles.track}>
                          <View style={[styles.fill, { width: `${(hp / maxHp) * 100}%` }]} />
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </Group>

            {(done || (current && isBossFight(fightNow))) && (
              <View style={styles.bossLine}>
                <Text style={styles.bossWho}>{monster.bossName}:</Text>
                <Text style={styles.bossText}>“{content.bossLine}”</Text>
              </View>
            )}

            {/* --------------------------------------------------------- the fight */}
            {current && (
              <View style={styles.card}>
                <View style={styles.weakness}>
                  <View style={[styles.dot, { backgroundColor: statColors[monster.weakness] }]} />
                  <Text style={styles.muted}>
                    Zayıflığı {statLabels[monster.weakness]}: bu tür alışkanlıklar saniyede 1.5 hasar verir.
                    Diğerleri saniyede 1.
                  </Text>
                </View>
                {sessionRunning ? (
                  <Button label="Savaşa dön" onPress={() => router.navigate('/')} accessibilityLabel="Süren savaşa dön" />
                ) : picking ? (
                  <FightPicker
                    habits={habitsQuery.data?.habits ?? []}
                    weakness={monster.weakness}
                    busy={start.isPending}
                    onPick={(habitId) => start.mutate(habitId)}
                    onAddHabit={(category) =>
                      router.navigate({ pathname: '/', params: { add: category ?? 'any', at: String(Date.now()) } })
                    }
                  />
                ) : (
                  <Button label="Savaşa başla" onPress={() => setPicking(true)} accessibilityLabel="Savaşa başla" />
                )}
                {error !== null && <Text style={styles.error}>{error}</Text>}
              </View>
            )}

            {/* -------------------------------------------------------- the ending */}
            {done && <Speech text={content.outro} gold />}

            <Pressable
              onPress={() => router.navigate(`/monster/${monster.key}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Icon name="study" size={16} color={colors.accent} />
              <Text style={styles.linkText}>Canavar kitabında {monster.name}</Text>
              <Icon name="chevron-right" size={16} color={colors.accent} />
            </Pressable>

            <Text style={styles.footnote}>
              Bu bölümün temel süresi {chapterBaseMinutes(chapter)} dk. Her çalıştığın saniye 1 hasar.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Işıl speaking — or, gold, the scene that closes a chapter. */
function Speech({ text, gold = false }: { readonly text: string; readonly gold?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.speech, gold && styles.speechGold]}>
      <View style={styles.isil}>
        <Icon name="flame-filled" size={18} color={colors.fire} />
      </View>
      <Text style={styles.speechText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  pressed: { opacity: 0.6 },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  overline: { ...type.caption, color: colors.textMuted },
  region: { ...type.title, color: colors.text },
  monsterName: { ...type.label, color: colors.danger },

  card: { ...cardStyle, gap: spacing.md },
  muted: { ...type.body, color: colors.textMuted, flex: 1, lineHeight: 21 },
  section: { ...type.heading, color: colors.text, paddingHorizontal: spacing.xs },

  speech: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  speechGold: { backgroundColor: colors.goldSoft },
  isil: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.fireSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speechText: { ...type.body, color: colors.text, flex: 1, lineHeight: 21 },

  stop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.md },
  stopIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIconWon: { backgroundColor: colors.successSoft },
  stopIconNow: { backgroundColor: colors.danger },
  stopText: { flex: 1, gap: 2, paddingVertical: spacing.sm },
  stopName: { ...type.label, color: colors.text },
  stopMeta: { ...type.caption, color: colors.textMuted },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },

  bossLine: { gap: 2, paddingHorizontal: spacing.xs },
  bossWho: { ...type.label, color: colors.danger },
  bossText: { ...type.body, color: colors.text, fontStyle: 'italic' },

  weakness: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 7 },
  error: { ...type.caption, color: colors.danger },

  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  linkText: { ...type.label, color: colors.accent },
  footnote: { ...type.caption, color: colors.textFaint },
});
