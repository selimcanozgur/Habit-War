/**
 * One duel, as a card.
 *
 * Read as a race. The two scores face each other across the card in display type,
 * and between them is a single split bar rather than two separate progress bars: a
 * duel is zero-sum — the only question the user has is "am I ahead?" — and one bar
 * whose fill crosses a centre marker answers that in a glance, where two bars force
 * a comparison. The marker is what makes the bar a race rather than a gauge: past it
 * you are winning, short of it you are not.
 *
 * The bar animates for the same reason the XP bar does, and carries the same
 * highlight along the top of its fill, so the two read as one language.
 *
 * A pending duel has no scores yet, so it renders as an invitation with
 * accept/decline instead of a scoreboard.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { Button, cardStyle } from './Button';

/** Matches the XP bar's fill duration so the two read as one visual language. */
const FILL_MS = 900;

/** Thick enough to carry the highlight line that marks this language's bars. */
const TRACK_HEIGHT = 18;
/** The elapsed-time bar is deliberately slighter: it is context, not the score. */
const TIME_TRACK_HEIGHT = 6;
/** Reused from XpBar: a white veil over a saturated fill, not a new colour. */
const SHINE_OPACITY = 0.42;

const ICON_SIZE = 18;

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

  // Green means "ahead" throughout the app, so the bar turns green the moment the
  // fill passes the marker and the verdict pill agrees with it.
  const leadColor = leading ? colors.success : colors.accent;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons
            name={isFinished ? 'trophy' : isPending ? 'mail-unread-outline' : 'flame'}
            size={ICON_SIZE}
            color={isFinished ? colors.textFaint : isPending ? colors.info : colors.warning}
          />
          <Text style={styles.category}>{describeCategory(challenge.category)}</Text>
        </View>
        <View style={styles.headerRight}>
          <Ionicons
            name="time-outline"
            size={ICON_SIZE}
            color={isFinished ? colors.textFaint : colors.warning}
          />
          <Text style={[styles.time, isFinished && styles.timeFinished]}>
            {isFinished ? 'Bitti' : isPending ? 'Davet bekliyor' : formatTimeRemaining(challenge.endsAt)}
          </Text>
        </View>
      </View>

      {isPending ? (
        <>
          <View style={styles.names}>
            <Text style={styles.nameMine} numberOfLines={1}>
              {viewerId === null ? mine.displayName : 'Sen'}
            </Text>
            <Text style={styles.nameTheirs} numberOfLines={1}>
              {theirs.displayName}
            </Text>
          </View>
          <Text style={styles.pendingNote}>
            {viewerIsChallenger
              ? 'Rakibinin daveti kabul etmesi bekleniyor.'
              : `${theirs.displayName} seni düelloya çağırdı.`}
          </Text>
        </>
      ) : (
        <>
          {/* Score above the bar on each side, so the number and the length of the
              fill it produced sit in the same column. */}
          <View style={styles.scoreboard}>
            <View style={styles.side}>
              <Text style={styles.nameMine} numberOfLines={1}>
                {viewerId === null ? mine.displayName : 'Sen'}
              </Text>
              <Text style={[styles.score, { color: leadColor }]} numberOfLines={1}>
                {myXp}
              </Text>
            </View>

            <Text style={styles.versus}>XP</Text>

            <View style={styles.sideRight}>
              <Text style={styles.nameTheirs} numberOfLines={1}>
                {theirs.displayName}
              </Text>
              <Text style={[styles.score, styles.scoreTheirs]} numberOfLines={1}>
                {theirXp}
              </Text>
            </View>
          </View>

          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel={`Düello skoru: sen ${myXp} XP, ${theirs.displayName} ${theirXp} XP`}
          >
            <Animated.View style={[styles.fill, { backgroundColor: leadColor }, fillStyle]}>
              <View style={styles.shine} />
            </Animated.View>
            {/* The halfway line. Crossing it is the whole message of the card, so it
                is drawn over the fill rather than behind it. */}
            <View style={styles.midMarker} pointerEvents="none" />
          </View>

          <View
            style={[
              styles.verdict,
              {
                backgroundColor: tied
                  ? colors.surfaceRaised
                  : leading
                    ? colors.successSoft
                    : colors.dangerSoft,
              },
            ]}
          >
            <Ionicons
              name={tied ? 'remove-outline' : leading ? 'trending-up' : 'trending-down'}
              size={ICON_SIZE}
              color={tied ? colors.textMuted : leading ? colors.successDark : colors.dangerDark}
            />
            <Text
              style={[
                styles.verdictText,
                { color: tied ? colors.textMuted : leading ? colors.successDark : colors.dangerDark },
              ]}
            >
              {tied ? 'Berabere' : leading ? 'Öndesin' : 'Geridesin'}
            </Text>
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
            <Button
              label="Kabul et"
              tone="success"
              size="small"
              block={false}
              style={styles.actionButton}
              disabled={busy}
              onPress={() => onAccept(challenge.id)}
              accessibilityLabel={`${theirs.displayName} ile düelloyu kabul et`}
            />
          )}
          {onDecline !== undefined && (
            <Button
              label="Reddet"
              tone="neutral"
              size="small"
              block={false}
              style={styles.actionButton}
              disabled={busy}
              onPress={() => onDecline(challenge.id)}
              accessibilityLabel={`${theirs.displayName} ile düelloyu reddet`}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.sm },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  category: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  time: { ...type.caption, color: colors.warningDark },
  timeFinished: { color: colors.textFaint },

  names: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },

  scoreboard: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  side: { flex: 1, gap: 2 },
  sideRight: { flex: 1, gap: 2, alignItems: 'flex-end' },
  nameMine: { ...type.label, color: colors.accent, flex: 1 },
  nameTheirs: { ...type.label, color: colors.textMuted, flex: 1, textAlign: 'right' },
  score: { ...type.display, color: colors.text },
  scoreTheirs: { color: colors.textMuted },
  /** The unit, stated once between the two numbers instead of after each. */
  versus: { ...type.overline, color: colors.textFaint, paddingBottom: spacing.sm },

  pendingNote: { ...type.body, color: colors.textMuted },

  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    justifyContent: 'flex-start',
    // A fill at 0% must not show a rounded stub of colour.
    minWidth: 0,
  },
  shine: {
    height: 4,
    marginTop: 3,
    marginHorizontal: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.textOnAccent,
    opacity: SHINE_OPACITY,
  },
  midMarker: {
    position: 'absolute',
    left: '50%',
    // Half the line's width, so the line straddles the midpoint rather than
    // starting at it.
    marginLeft: -1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.bg,
  },

  verdict: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  verdictText: { ...type.label },

  timeTrack: {
    height: TIME_TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  timeFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.warning },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionButton: { flex: 1 },
});
