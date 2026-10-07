/**
 * The story map (docs/game-design.md §5.4): twenty chapters on one winding road.
 *
 * Read top to bottom, chapter 1 first, and the page scrolls itself to the chapter under
 * way. A stop is gold once its boss has fallen, pulses while it is the current one, and
 * stays locked — its monster unnamed — until the road reaches it. There is no choosing
 * a monster: the story is one road, and the next fight is simply the next stop.
 */

import { FIGHTS_PER_CHAPTER, STORY_CHAPTERS, chapterMonster } from '@habitwar/domain';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { getStory, type StoryState } from '../../src/api/story';
import { cardStyle } from '../../src/components/Button';
import { MonsterEmblem } from '../../src/components/Emblems';
import { Icon } from '../../src/components/Icon';
import { ScreenHero } from '../../src/components/ScreenHero';
import { STORY_PREMISE, chapterContent } from '../../src/story/content';
import { colors, radius, spacing, type } from '../../src/theme';

/** The road's sway: each stop's horizontal place, as a share of the free width. */
const SWAY: readonly number[] = [0.1, 0.45, 0.8, 0.45];
const NODE = 64;

type StopState = 'done' | 'current' | 'locked';

function stopState(story: StoryState, chapter: number): StopState {
  if (story.finished || chapter < story.position.chapter) return 'done';
  return chapter === story.position.chapter ? 'current' : 'locked';
}

export default function StoryScreen(): React.JSX.Element {
  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const story = storyQuery.data?.story ?? null;
  const scroll = useRef<ScrollView>(null);
  // A stop's y is relative to the road; the road's to the body; the body's to the page.
  const currentY = useRef<number | null>(null);
  const bodyY = useRef(0);
  const roadY = useRef(0);
  const scrolled = useRef(false);

  // Bring the chapter under way into view once the road has been laid out.
  useEffect(() => {
    if (!story || scrolled.current) return;
    const id = setTimeout(() => {
      if (currentY.current !== null) {
        const y = bodyY.current + roadY.current + currentY.current;
        scroll.current?.scrollTo({ y: Math.max(0, y - 160), animated: true });
        scrolled.current = true;
      }
    }, 300);
    return () => clearTimeout(id);
  }, [story]);

  const fresh =
    story !== null &&
    story.completed.length === 0 &&
    story.position.chapter === 1 &&
    story.position.fight === 1 &&
    story.position.damage === 0;

  return (
    <View style={styles.screen}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHero
          image="battle"
          title="Hikaye"
          subtitle={
            story?.current
              ? `Bölüm ${story.current.chapter} · ${chapterContent(story.current.chapter).region}`
              : story?.finished
                ? 'İrade Ateşi yeniden yanıyor'
                : undefined
          }
          action={
            <Pressable
              onPress={() => router.navigate('/monsters')}
              accessibilityRole="button"
              accessibilityLabel="Canavar kitabını aç"
              style={({ pressed }) => [styles.bookButton, pressed && styles.pressed]}
            >
              <Icon name="study" size={16} color={colors.text} />
              <Text style={styles.bookText}>Canavar Kitabı</Text>
            </Pressable>
          }
        />

        <View style={styles.body} onLayout={(event) => (bodyY.current = event.nativeEvent.layout.y)}>
          {storyQuery.isPending && <ActivityIndicator color={colors.accent} style={styles.loader} />}

          {fresh && (
            <View style={styles.premise}>
              <View style={styles.premiseHead}>
                <Icon name="flame-filled" size={18} color={colors.fire} />
                <Text style={styles.premiseTitle}>Önsöz</Text>
              </View>
              <Text style={styles.premiseText}>{STORY_PREMISE}</Text>
            </View>
          )}

          {story && (
            <View style={styles.road} onLayout={(event) => (roadY.current = event.nativeEvent.layout.y)}>
              {Array.from({ length: STORY_CHAPTERS }, (_, index) => {
                const chapter = index + 1;
                const state = stopState(story, chapter);
                return (
                  <View
                    key={chapter}
                    onLayout={(event) => {
                      if (state === 'current') currentY.current = event.nativeEvent.layout.y;
                    }}
                  >
                    {chapter > 1 && <Connector from={SWAY[(index - 1) % SWAY.length] ?? 0} to={SWAY[index % SWAY.length] ?? 0} done={state !== 'locked'} />}
                    <Stop
                      chapter={chapter}
                      state={state}
                      sway={SWAY[index % SWAY.length] ?? 0}
                      fightsWon={state === 'current' ? story.position.fight - 1 : state === 'done' ? FIGHTS_PER_CHAPTER : 0}
                    />
                  </View>
                );
              })}
              <View style={styles.summit}>
                <Icon name="flame-filled" size={22} color={story.finished ? colors.fire : colors.textFaint} />
                <Text style={styles.summitText}>
                  {story.finished ? 'İrade Ateşi yeniden yanıyor' : 'Yolun sonunda: Sönmüş Kule'}
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Stop({
  chapter,
  state,
  sway,
  fightsWon,
}: {
  readonly chapter: number;
  readonly state: StopState;
  readonly sway: number;
  readonly fightsWon: number;
}): React.JSX.Element {
  const monster = chapterMonster(chapter);
  const locked = state === 'locked';
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (state !== 'current') return;
    pulse.value = withRepeat(
      withSequence(withTiming(1.08, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
    // `pulse` is a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  // The label sits on whichever side has room.
  const labelLeft = sway > 0.5;

  return (
    <Pressable
      disabled={locked}
      onPress={() => router.navigate(`/chapter/${chapter}`)}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={
        locked
          ? `Bölüm ${chapter}, kilitli`
          : `Bölüm ${chapter}: ${chapterContent(chapter).region}, ${monster.name}`
      }
      style={[styles.stop, { paddingLeft: `${sway * 70}%` }, labelLeft && styles.stopReverse]}
    >
      <Animated.View style={[styles.node, state === 'current' && styles.nodeCurrent, pulseStyle]}>
        <MonsterEmblem
          monsterKey={monster.key}
          size={NODE}
          locked={locked}
          defeated={state === 'done'}
        />
        <View style={[styles.badge, state === 'done' && styles.badgeDone, locked && styles.badgeLocked]}>
          <Text style={styles.badgeText}>{chapter}</Text>
        </View>
      </Animated.View>
      <View style={[styles.label, labelLeft && styles.labelRight]}>
        <Text style={[styles.region, locked && styles.faint]} numberOfLines={1}>
          {chapterContent(chapter).region}
        </Text>
        <Text style={[styles.monster, locked && styles.faint]} numberOfLines={1}>
          {locked ? '???' : monster.name}
        </Text>
        {state === 'current' && (
          <Text style={styles.progress}>
            {fightsWon >= FIGHTS_PER_CHAPTER - 1 ? 'Sırada BOSS' : `Savaş ${fightsWon + 1}/${FIGHTS_PER_CHAPTER - 1}`}
          </Text>
        )}
        {state === 'done' && <Text style={styles.doneText}>Kurtarıldı · {monster.title}</Text>}
      </View>
    </Pressable>
  );
}

/** The road between two stops: a dotted line leaning from one stop's place to the next. */
function Connector({ from, to, done }: { readonly from: number; readonly to: number; readonly done: boolean }): React.JSX.Element {
  const left = (from + to) / 2;
  return (
    <View style={[styles.connector, { paddingLeft: `${left * 70}%` }]}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={[styles.dot, { marginLeft: NODE / 2 - 3 + (to - from) * 20 * (dot - 1) }, done && styles.dotDone]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: spacing.xxl },
  body: { padding: spacing.md, gap: spacing.md },
  loader: { marginTop: spacing.xl },
  pressed: { opacity: 0.7 },

  bookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  bookText: { ...type.label, color: colors.text },

  premise: { ...cardStyle, gap: spacing.xs },
  premiseHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  premiseTitle: { ...type.heading, color: colors.text },
  premiseText: { ...type.body, color: colors.textMuted, lineHeight: 21 },

  road: { paddingVertical: spacing.sm },
  stop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stopReverse: { flexDirection: 'row-reverse', paddingLeft: 0 },
  node: { borderRadius: NODE * 0.3 },
  nodeCurrent: {
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  badge: {
    position: 'absolute',
    top: -6,
    left: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeDone: { backgroundColor: colors.goldDark },
  badgeLocked: { backgroundColor: colors.borderStrong },
  badgeText: { ...type.caption, fontFamily: 'Nunito_800ExtraBold', color: colors.textOnAccent },
  label: { flex: 1, gap: 1 },
  labelRight: { alignItems: 'flex-end' },
  region: { ...type.caption, color: colors.textMuted },
  monster: { ...type.heading, color: colors.text },
  faint: { color: colors.textFaint },
  progress: { ...type.caption, color: colors.accent, fontFamily: 'Nunito_800ExtraBold' },
  doneText: { ...type.caption, color: colors.goldDark },

  connector: { height: 30, justifyContent: 'space-evenly' },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  dotDone: { backgroundColor: colors.goldDark },

  summit: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  summitText: { ...type.label, color: colors.textMuted },
});
