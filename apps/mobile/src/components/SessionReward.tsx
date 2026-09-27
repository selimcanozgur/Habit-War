/**
 * The post-session reward.
 *
 * This is the moment the whole product is built around, so it does three things in
 * order: state the gain, animate the bar, and — only if a level was crossed —
 * celebrate. Haptics land on the gain and again on the level-up, because the spec is
 * right that a reward the phone does not acknowledge physically feels cheap.
 *
 * It also shows *why* the XP was what it was. XP the user cannot explain is XP they
 * will not trust, and the API already returns the full multiplier breakdown.
 *
 * The backdrop is a pale violet wash, not a dark scrim. A near-black veil was correct
 * when the app was dark and is actively wrong now: it would read as an error state or
 * a video player in the middle of the app's happiest moment. Tinting the whole screen
 * with the primary's soft shade says "something good happened" before a word is read,
 * and leaves the white card standing clearly on top of it.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { CompleteSessionResponse } from '../api/sessions';
import { colors, radius, spacing, statColors, statLabels, type } from '../theme';
import { Button, cardStyle } from './Button';
import { XpBar } from './XpBar';

const CHIP_ICON_SIZE = 16;
const NOTICE_ICON_SIZE = 18;

export interface SessionRewardProps {
  readonly result: CompleteSessionResponse;
  readonly habitName: string;
  readonly onDismiss: () => void;
}

export function SessionReward({
  result,
  habitName,
  onDismiss,
}: SessionRewardProps): React.JSX.Element {
  const [celebrating, setCelebrating] = useState(false);
  const badgeScale = useSharedValue(0.8);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  useEffect(() => {
    if (!celebrating) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    badgeScale.value = withSequence(
      withTiming(1.15, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
    );
  }, [celebrating, badgeScale]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));

  const ratio = result.xpForNextLevel === 0 ? 1 : result.xpIntoLevel / result.xpForNextLevel;
  const statColor = statColors[result.stat];

  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.overlay}>
      <Animated.View entering={FadeInDown.duration(320).springify()} style={styles.card}>
        <Text style={styles.habit}>{habitName}</Text>

        <Text style={styles.xp}>+{result.xp} XP</Text>

        <View style={styles.chips}>
          <View style={[styles.chip, { borderColor: statColor }]}>
            <Ionicons name="arrow-up-circle" size={CHIP_ICON_SIZE} color={statColor} />
            <Text style={[styles.chipText, { color: statColor }]}>
              +{result.statXp} {statLabels[result.stat]}
              {result.statPointsGained > 0 ? ` · +${result.statPointsGained} puan` : ''}
            </Text>
          </View>

          {result.streak > 1 && (
            <View style={styles.chip}>
              <Ionicons name="flame" size={CHIP_ICON_SIZE} color={colors.warning} />
              <Text style={styles.chipText}>{result.streak} günlük seri</Text>
            </View>
          )}
        </View>

        {/*
          The cap is surfaced, never hidden. A user who silently earns a fifth of what
          they expected will assume the app is broken — which is a worse outcome than
          the cap itself.
        */}
        {result.hitDailyCap && (
          <View style={styles.capNotice}>
            <Ionicons name="alert-circle" size={NOTICE_ICON_SIZE} color={colors.warningDark} />
            <Text style={styles.capNoticeText}>
              Bugünkü tavana ulaştın — bu seansın bir kısmı azalan verimle sayıldı.
            </Text>
          </View>
        )}

        <View style={styles.barWrapper}>
          <XpBar
            ratio={ratio}
            level={result.level}
            xpIntoLevel={result.xpIntoLevel}
            xpForNextLevel={result.xpForNextLevel}
            leveledUp={result.leveledUp}
            onFillComplete={result.leveledUp ? (): void => setCelebrating(true) : undefined}
          />
        </View>

        {celebrating && (
          <Animated.View style={[styles.levelBadge, badgeStyle]}>
            <Ionicons name="sparkles" size={NOTICE_ICON_SIZE} color={colors.textOnAccent} />
            <Text style={styles.levelBadgeText}>Seviye {result.level}</Text>
          </Animated.View>
        )}

        <Button label="Devam" onPress={onDismiss} accessibilityLabel="Devam et" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    ...cardStyle,
    // The card's outline is the primary rather than the usual grey: on the tinted
    // backdrop a grey border would disappear into it.
    borderColor: colors.accent,
    padding: spacing.lg,
    gap: spacing.md,
  },
  habit: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  xp: { ...type.display, color: colors.accent, textAlign: 'center' },

  chips: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipText: { ...type.label, color: colors.textMuted },

  capNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  capNoticeText: { ...type.caption, color: colors.warningDark, flex: 1 },

  barWrapper: { marginTop: spacing.xs },
  levelBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  levelBadgeText: { ...type.heading, color: colors.textOnAccent },
});
