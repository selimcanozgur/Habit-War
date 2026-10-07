/**
 * The battle screen (docs/game-design.md §5.3) — what a running session looks like.
 *
 * The fight is computed, not animated toward a guess: the story position the server
 * reported when the session began, fed the session's elapsed seconds through the
 * domain's `advanceStory` — the very function the server will run on completion. One
 * damage per second (one and a half against the weakness), fights falling and the next
 * monster stepping in mid-session, exactly as the result will be scored.
 *
 * The player's side carries the focus bar: leaving the app or pausing is the monster's
 * opening, the bar drops, and the XP focus bonus with it. The fight itself is never
 * lost — focus costs bonus, not progress.
 */

import {
  FIGHTS_PER_CHAPTER,
  advanceStory,
  chapterMonster,
  damageRate,
  fightMaxHp,
  focusLevel,
  isBossFight,
  isStoryFinished,
  resolveStat,
  type FightWon,
} from '@habitwar/domain';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { Habit } from '../api/sessions';
import type { StoryState } from '../api/story';
import { formatElapsed } from '../stores/timer';
import { chapterContent } from '../story/content';
import { colors, radius, spacing, type } from '../theme';
import { Button } from './Button';
import { FocusBar, MonsterEmblem, PlayerEmblem } from './Emblems';
import { Icon } from './Icon';

const BANNER_MS = 2800;

/**
 * Işıl's tips through the first chapter, one at a time while the clock runs. A new
 * player learns the rules inside their first fights, where they matter, instead of
 * from a page they skipped.
 */
const FIRST_CHAPTER_TIPS: readonly string[] = [
  'Her saniye 1 hasar. Sayaç işledikçe canavarın canı erir.',
  'Uygulamadan çıkma: canavar karşı saldırır ve odağın düşer.',
  'Canavar düşse de devam et: artan hasar sıradakine geçer.',
  'İşin bitince Bitir\'e bas. XP ve hasar o an kaydedilir.',
];
const TIP_SECONDS = 7;

export interface BattleViewProps {
  readonly story: StoryState | null;
  readonly habit: Habit | null;
  readonly elapsedSec: number;
  /** App exits plus pauses: every opening the monster got. */
  readonly interruptions: number;
  readonly paused: boolean;
  readonly playerName: string;
  readonly playerLevel: number;
  readonly busy: boolean;
  readonly pausing: boolean;
  readonly finishing: boolean;
  readonly onTogglePause: () => void;
  readonly onFinish: () => void;
  readonly onAbandon: () => void;
}

type Banner =
  | { readonly kind: 'win'; readonly win: FightWon; readonly name: string; readonly title: string }
  | { readonly kind: 'counter'; readonly name: string };

export function BattleView({
  story,
  habit,
  elapsedSec,
  interruptions,
  paused,
  playerName,
  playerLevel,
  busy,
  pausing,
  finishing,
  onTogglePause,
  onFinish,
  onAbandon,
}: BattleViewProps): React.JSX.Element {
  const stat = habit ? resolveStat(habit.category, habit.stat) : null;
  const live =
    story !== null && stat !== null && !story.finished
      ? advanceStory(story.position, elapsedSec, stat)
      : null;
  const position = live?.position ?? story?.position ?? null;
  const inStory = position !== null && !isStoryFinished(position);
  const monster = inStory && position ? chapterMonster(position.chapter) : null;
  const boss = inStory && position ? isBossFight(position.fight) : false;
  const maxHp = inStory && position ? fightMaxHp(position.chapter, position.fight) : 0;
  const hp = inStory && position ? Math.max(0, maxHp - position.damage) : 0;
  const rate = monster && stat ? damageRate(stat, monster) : 1;
  const sessionDamage = live?.damage ?? 0;
  const focus = focusLevel(interruptions);

  // --- A fight fell mid-session: a victory banner, then the next monster fights on.
  const [banner, setBanner] = useState<Banner | null>(null);
  const wonCount = useRef(live?.won.length ?? 0);
  useEffect(() => {
    const won = live?.won ?? [];
    if (won.length > wonCount.current) {
      const win = won[won.length - 1] as FightWon;
      const fallen = chapterMonster(win.chapter);
      setBanner({
        kind: 'win',
        win,
        name: win.isBoss ? fallen.bossName : fallen.name,
        title: win.isBoss ? fallen.title : '',
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    wonCount.current = won.length;
  }, [live?.won]);

  // --- Leaving the app or pausing: the monster's counter-attack.
  const shake = useSharedValue(0);
  const seenInterruptions = useRef(interruptions);
  useEffect(() => {
    if (interruptions > seenInterruptions.current && monster) {
      setBanner({ kind: 'counter', name: boss ? monster.bossName : monster.name });
      shake.value = withSequence(
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(-4, { duration: 60 }),
        withTiming(0, { duration: 60 }),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    seenInterruptions.current = interruptions;
    // `shake` is a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interruptions]);
  const playerShake = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(id);
  }, [banner]);

  // --- Each second's blow, floating off the monster.
  const lastDamage = useRef(sessionDamage);
  const [pop, setPop] = useState<{ readonly id: number; readonly value: number } | null>(null);
  useEffect(() => {
    const delta = sessionDamage - lastDamage.current;
    lastDamage.current = sessionDamage;
    if (delta > 0 && !paused) setPop({ id: sessionDamage, value: delta });
  }, [sessionDamage, paused]);

  // --- Abandoning takes the session's damage back: two taps, the second one informed.
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  useEffect(() => {
    if (!confirmAbandon) return;
    const id = setTimeout(() => setConfirmAbandon(false), 4000);
    return () => clearTimeout(id);
  }, [confirmAbandon]);

  // While the story is in its first chapter, a tip rotates under the clock.
  const tip =
    inStory && position && position.chapter === 1 && !paused
      ? FIRST_CHAPTER_TIPS[Math.floor(elapsedSec / TIP_SECONDS) % FIRST_CHAPTER_TIPS.length]
      : undefined;

  const targetSec = (habit?.targetMinutes ?? 0) * 60;
  const targetRatio = targetSec > 0 ? Math.min(1, elapsedSec / targetSec) : 0;

  return (
    <View style={styles.screen}>
      {/* ------------------------------------------------------------ the arena */}
      <View style={styles.arena}>
        <Animated.View style={[styles.side, playerShake]}>
          <PlayerEmblem size={64} />
          <Text style={styles.sideName} numberOfLines={1}>
            {playerName}
          </Text>
          <Text style={styles.sideMeta}>Seviye {playerLevel}</Text>
          <View style={styles.sideBar}>
            <FocusBar level={focus} onDark />
          </View>
          <Text style={styles.sideMeta}>{focus === 4 ? 'Odak tam' : `Odak ${focus}/4`}</Text>
        </Animated.View>

        <Text style={styles.vs}>VS</Text>

        {monster && position ? (
          <View style={styles.side}>
            <View>
              <MonsterEmblem monsterKey={monster.key} size={64} boss={boss} onDark />
              {pop && (
                <Animated.Text
                  key={pop.id}
                  entering={FadeInDown.duration(120)}
                  exiting={FadeOutUp.duration(400)}
                  style={styles.pop}
                >
                  −{pop.value}
                </Animated.Text>
              )}
            </View>
            <Text style={styles.sideName} numberOfLines={1}>
              {boss ? monster.bossName : monster.name}
            </Text>
            <Text style={[styles.sideMeta, boss && styles.bossMeta]}>
              {boss ? 'BOSS' : `Bölüm ${position.chapter} · Savaş ${position.fight}/${FIGHTS_PER_CHAPTER - 1}`}
            </Text>
            <View style={styles.sideBar}>
              <View style={styles.hpTrack}>
                <View style={[styles.hpFill, { width: `${maxHp > 0 ? (hp / maxHp) * 100 : 0}%` }]} />
              </View>
            </View>
            <Text style={styles.sideMeta}>
              {hp} / {maxHp}
            </Text>
          </View>
        ) : (
          <View style={styles.side}>
            <PlayerEmblem size={64} />
            <Text style={styles.sideName}>Hikaye tamam</Text>
            <Text style={styles.sideMeta}>İrade Ateşi yanıyor</Text>
          </View>
        )}
      </View>

      {/* ------------------------------------------------------------ banners */}
      <View style={styles.bannerSlot}>
        {banner?.kind === 'win' && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[styles.banner, styles.bannerWin]}>
            <Icon name="trophy" size={18} color={colors.goldDark} />
            <Text style={styles.bannerText}>
              {banner.win.isBoss
                ? `${banner.name} yenildi! Bölüm ${banner.win.chapter} tamamlandı · Unvan: ${banner.title}`
                : `Zafer! ${banner.name} yenildi. Sıradaki geliyor...`}
            </Text>
          </Animated.View>
        )}
        {banner?.kind === 'counter' && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[styles.banner, styles.bannerCounter]}>
            <Icon name="alert" size={18} color={colors.danger} />
            <Text style={styles.bannerText}>{banner.name} karşı saldırdı! Odağın düştü.</Text>
          </Animated.View>
        )}
      </View>

      {/* ------------------------------------------------------------ the clock */}
      <View style={styles.clock}>
        <Text style={styles.habit} numberOfLines={1}>
          {habit?.name ?? 'Seans'}
        </Text>
        <Text style={styles.timer}>{formatElapsed(elapsedSec)}</Text>
        {inStory && (
          <Text style={styles.damage}>
            Bu seans: {sessionDamage} hasar · saniyede {rate}
            {rate > 1 ? ' (zayıf nokta!)' : ''}
          </Text>
        )}
        {paused && <Text style={styles.paused}>Duraklatıldı — canavar bekliyor.</Text>}
        {tip !== undefined && (
          <Animated.View key={tip} entering={FadeIn.duration(300)} style={styles.tip}>
            <Icon name="flame-filled" size={14} color={colors.fire} />
            <Text style={styles.tipText}>{tip}</Text>
          </Animated.View>
        )}
        {targetSec > 0 && (
          <View style={styles.target}>
            <View style={styles.targetTrack}>
              <View
                style={[
                  styles.targetFill,
                  { width: `${Math.round(targetRatio * 100)}%` },
                  targetRatio >= 1 && styles.targetDone,
                ]}
              />
            </View>
            <Text style={styles.targetLabel}>{habit?.targetMinutes} dk hedef</Text>
          </View>
        )}
      </View>

      {/* ------------------------------------------------------------ actions */}
      <View style={styles.actions}>
        <Button
          label={paused ? 'Devam et' : 'Duraklat'}
          tone={paused ? 'primary' : 'neutral'}
          loading={pausing}
          disabled={busy}
          onPress={onTogglePause}
          accessibilityLabel={paused ? 'Seansa devam et' : 'Seansı duraklat'}
        />
        <Button
          label={finishing ? 'Bitiriliyor…' : 'Bitir'}
          loading={finishing}
          disabled={busy}
          onPress={onFinish}
          accessibilityLabel="Seansı bitir"
        />
        <Pressable
          disabled={busy}
          onPress={() => (confirmAbandon ? onAbandon() : setConfirmAbandon(true))}
          accessibilityRole="button"
          accessibilityLabel={confirmAbandon ? 'Seanstan vazgeçmeyi onayla' : 'Seanstan vazgeç'}
          style={({ pressed }) => [styles.abandon, pressed && styles.pressed]}
        >
          <Text style={styles.abandonText}>
            {confirmAbandon
              ? sessionDamage > 0
                ? `Bu seanstaki ${sessionDamage} hasar geri alınacak — emin misin?`
                : 'Seans sayılmayacak — emin misin?'
              : 'Vazgeç'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md, gap: spacing.md, justifyContent: 'center' },

  arena: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
  },
  side: { flex: 1, alignItems: 'center', gap: 2 },
  sideName: { ...type.heading, color: colors.textOnDark, marginTop: spacing.xs, textAlign: 'center' },
  sideMeta: { ...type.caption, color: colors.textOnDarkMuted, textAlign: 'center' },
  bossMeta: { color: colors.danger, fontFamily: 'Nunito_800ExtraBold' },
  sideBar: { alignSelf: 'stretch', marginTop: spacing.xs },
  vs: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 26,
    color: colors.gold,
    marginTop: 18,
  },
  hpTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  hpFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  pop: {
    position: 'absolute',
    top: -14,
    right: -12,
    ...type.label,
    fontFamily: 'Nunito_800ExtraBold',
    color: colors.danger,
  },

  bannerSlot: { minHeight: 44, justifyContent: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
  },
  bannerWin: { backgroundColor: colors.goldSoft },
  bannerCounter: { backgroundColor: colors.dangerSoft },
  bannerText: { ...type.label, color: colors.text, flex: 1 },

  clock: { alignItems: 'center', gap: spacing.xs },
  habit: { ...type.heading, color: colors.textMuted },
  timer: { ...type.timer, color: colors.text },
  damage: { ...type.label, color: colors.danger },
  paused: { ...type.caption, color: colors.textMuted },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.fireSoft,
    marginTop: spacing.xs,
  },
  tipText: { ...type.caption, color: colors.text, flexShrink: 1 },
  target: { alignSelf: 'stretch', gap: spacing.xs, marginTop: spacing.sm },
  targetTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  targetFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  targetDone: { backgroundColor: colors.success },
  targetLabel: { ...type.caption, color: colors.textFaint, textAlign: 'center' },

  actions: { gap: spacing.sm },
  abandon: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.6 },
  abandonText: { ...type.label, color: colors.danger, textAlign: 'center' },
});
