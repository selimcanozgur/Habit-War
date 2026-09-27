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
 * The backdrop is stone at three-quarters opacity. The app's ground is already dark,
 * so a pale veil would read as a blank page rather than a layer above one; dimming
 * the world instead pushes everything but the parchment card out of focus, which is
 * exactly the emphasis this moment wants.
 */

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
import { Icon, STAT_ICONS } from './Icon';
import { XpBar } from './XpBar';

/**
 * The scrim over the world behind the card.
 *
 * Written as rgba rather than a token because `colors.stone` is opaque and the
 * overlay needs to let the screen beneath show through; the channels are stone's.
 */
const OVERLAY_TINT = 'rgba(30, 30, 28, 0.78)';

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
  const statIcon = STAT_ICONS[result.stat] ?? 'star';

  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.overlay}>
      <Animated.View entering={FadeInDown.duration(320).springify()} style={styles.card}>
        <Text style={styles.habit}>{habitName}</Text>

        <Text style={styles.xp}>+{result.xp} XP</Text>

        <View style={styles.chips}>
          <View style={[styles.chip, { borderColor: statColor }]}>
            <Icon name={statIcon} size={CHIP_ICON_SIZE} color={statColor} />
            <Text style={[styles.chipText, { color: statColor }]}>
              +{result.statXp} {statLabels[result.stat]}
              {result.statPointsGained > 0 ? ` · +${result.statPointsGained} puan` : ''}
            </Text>
          </View>

          {result.streak > 1 && (
            <View style={styles.chip}>
              <Icon name="flame-filled" size={CHIP_ICON_SIZE} color={colors.fire} />
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
            <Icon name="alert" size={NOTICE_ICON_SIZE} color={colors.fireDark} />
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
            <Icon name="star-filled" size={NOTICE_ICON_SIZE} color={colors.textOnAccent} />
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
    backgroundColor: OVERLAY_TINT,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    ...cardStyle,
    // Gold rather than the usual warm border: against the dimmed world the card
    // should read as the one lit object on the screen.
    borderColor: colors.goldDark,
    padding: spacing.lg,
    gap: spacing.md,
  },
  habit: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  xp: { ...type.display, color: colors.xp, textAlign: 'center' },

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
    backgroundColor: colors.fireSoft,
  },
  capNoticeText: { ...type.caption, color: colors.fireDark, flex: 1 },

  barWrapper: { marginTop: spacing.xs },
  levelBadge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.xp,
  },
  levelBadgeText: { ...type.heading, color: colors.textOnAccent },
});
