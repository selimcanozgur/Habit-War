/**
 * One duel, as a card.
 *
 * The centrepiece is a single split bar rather than two separate progress bars.
 * A duel is zero-sum — the only question the user has is "am I ahead?" — and one
 * bar whose midpoint moves answers that in a glance, where two bars force a
 * comparison. The bar animates for the same reason the XP bar does: seeing your
 * half grow is the reward.
 *
 * A pending duel has no scores yet, so it renders as an invitation with
 * accept/decline instead of a scoreboard.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  challengeElapsedRatio,
  describeCategory,
  formatTimeRemaining,
  type Challenge,
} from '../api/social';
import { colors, radius, spacing, type } from '../theme';

/** Matches the XP bar's fill duration so the two read as one visual language. */
const FILL_MS = 900;

export interface DuelCardProps {
  readonly challenge: Challenge;
  /** Signed-in user's id, used to decide which side of the bar is "you". */
  readonly viewerId: string | null;
  readonly onAccept?: ((challengeId: string) => void) | undefined;
  readonly onDecline?: ((challengeId: string) => void) | undefined;
  readonly busy?: boolean;
}

export function DuelCard({
  challenge,
  viewerId,
  onAccept,
  onDecline,
  busy = false,
}: DuelCardProps): React.JSX.Element {
  // Fall back to "you are the challenger" when the viewer is unknown, so the card
  // still labels a side rather than rendering two anonymous opponents.
  const viewerIsChallenger =
    viewerId === null ? true : challenge.challenger.id === viewerId;

  const mine = viewerIsChallenger ? challenge.challenger : challenge.opponent;
  const theirs = viewerIsChallenger ? challenge.opponent : challenge.challenger;
  const myXp = viewerIsChallenger ? challenge.challengerXp : challenge.opponentXp;
  const theirXp = viewerIsChallenger ? challenge.opponentXp : challenge.challengerXp;

  const total = myXp + theirXp;
  // A scoreless duel sits at dead centre rather than collapsing to zero width.
  const share = total > 0 ? myXp / total : 0.5;

  const fill = useSharedValue(share);

  useEffect(() => {
    fill.value = withTiming(share, { duration: FILL_MS, easing: Easing.out(Easing.cubic) });
    // `fill` is a stable shared value; including it would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, fill.value * 100))}%`,
  }));

  const isPending = challenge.status === 'PENDING';
  const isFinished = challenge.status === 'COMPLETED';
  const timeElapsed = challengeElapsedRatio(challenge.startsAt, challenge.endsAt);

  const leading = myXp > theirXp;
  const tied = myXp === theirXp;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.category}>{describeCategory(challenge.category)}</Text>
        <Text style={[styles.time, isFinished && styles.timeFinished]}>
          {isFinished ? 'Bitti' : isPending ? 'Davet bekliyor' : formatTimeRemaining(challenge.endsAt)}
        </Text>
      </View>

      <View style={styles.names}>
        <Text style={styles.nameMine} numberOfLines={1}>
          {viewerId === null ? mine.displayName : 'Sen'}
        </Text>
        <Text style={styles.nameTheirs} numberOfLines={1}>
          {theirs.displayName}
        </Text>
      </View>

      {isPending ? (
        <Text style={styles.pendingNote}>
          {viewerIsChallenger
            ? 'Rakibinin daveti kabul etmesi bekleniyor.'
            : `${theirs.displayName} seni düelloya çağırdı.`}
        </Text>
      ) : (
        <>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel={`Düello skoru: sen ${myXp} XP, ${theirs.displayName} ${theirXp} XP`}
          >
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>

          <View style={styles.scores}>
            <Text style={styles.scoreMine}>{myXp} XP</Text>
            <Text style={styles.scoreStatus}>
              {tied ? 'Berabere' : leading ? 'Öndesin' : 'Geridesin'}
            </Text>
            <Text style={styles.scoreTheirs}>{theirXp} XP</Text>
          </View>

          {/* Time is a separate, thinner bar: knowing you are behind matters less if
              the duel has six days left, and more if it has six hours. */}
          {!isFinished && (
            <View style={styles.timeTrack}>
              <View style={[styles.timeFill, { width: `${Math.round(timeElapsed * 100)}%` }]} />
            </View>
          )}
        </>
      )}

      {isPending && !viewerIsChallenger && (onAccept !== undefined || onDecline !== undefined) && (
        <View style={styles.actions}>
          {onAccept !== undefined && (
            <Pressable
              style={[styles.acceptButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={() => onAccept(challenge.id)}
              accessibilityRole="button"
              accessibilityLabel={`${theirs.displayName} ile düelloyu kabul et`}
            >
              <Text style={styles.acceptText}>Kabul et</Text>
            </Pressable>
          )}
          {onDecline !== undefined && (
            <Pressable
              style={[styles.declineButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={() => onDecline(challenge.id)}
              accessibilityRole="button"
              accessibilityLabel={`${theirs.displayName} ile düelloyu reddet`}
            >
              <Text style={styles.declineText}>Reddet</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: {
    ...type.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  time: { ...type.caption, color: colors.warning },
  timeFinished: { color: colors.textFaint },

  names: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  nameMine: { ...type.label, color: colors.accentBright, flex: 1 },
  nameTheirs: { ...type.label, color: colors.textMuted, flex: 1, textAlign: 'right' },

  pendingNote: { ...type.body, color: colors.textMuted },

  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },

  scores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreMine: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'], flex: 1 },
  scoreStatus: { ...type.caption, color: colors.textFaint },
  scoreTheirs: {
    ...type.label,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flex: 1,
    textAlign: 'right',
  },

  timeTrack: {
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  timeFill: { height: '100%', backgroundColor: colors.textFaint },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  acceptButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  acceptText: { ...type.label, color: '#FFFFFF' },
  declineButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
  },
  declineText: { ...type.label, color: colors.textMuted },
  buttonDisabled: { opacity: 0.5 },
});
