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
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { XpBar } from './XpBar';

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
            <Text style={[styles.chipText, { color: statColor }]}>
              +{result.statXp} {statLabels[result.stat]}
              {result.statPointsGained > 0 ? ` · +${result.statPointsGained} puan` : ''}
            </Text>
          </View>

          {result.streak > 1 && (
            <View style={styles.chip}>
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
          <Text style={styles.capNotice}>
            Bugünkü tavana ulaştın — bu seansın bir kısmı azalan verimle sayıldı.
          </Text>
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
            <Text style={styles.levelBadgeText}>Seviye {result.level}</Text>
          </Animated.View>
        )}

        <Pressable
          style={styles.button}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Devam et"
        >
          <Text style={styles.buttonText}>Devam</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11, 13, 20, 0.92)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  habit: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  xp: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.accentBright,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { ...type.caption, color: colors.textMuted },
  capNotice: { ...type.caption, color: colors.warning, textAlign: 'center' },
  barWrapper: { marginTop: spacing.xs },
  levelBadge: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  levelBadgeText: { ...type.heading, color: '#FFFFFF' },
  button: {
    marginTop: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
  },
  buttonText: { ...type.heading, color: colors.text },
});
