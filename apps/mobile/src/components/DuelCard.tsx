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
 * The bar animates for the same reason the XP bar does, so the two read as one
 * language. The card is an ordinary card: the scores and the bar are what make it a
 * contest, and the verdict under the bar says the one word the card exists to say.
 * Time remaining is stated once, in the header, rather than again as a second bar.
 *
 * A pending duel has no scores yet, so it renders as an invitation with
 * accept/decline instead of a scoreboard.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  describeCategory,
  formatTimeRemaining,
  type Challenge,
  type CheckIn,
} from '../api/social';
import { colors, radius, spacing, type } from '../theme';
import { Button, cardStyle, ChipButton } from './Button';
import { Icon } from './Icon';

/** Matches the XP bar's fill duration so the two read as one visual language. */
const FILL_MS = 900;

/** Matches the XP bar's track. */
const TRACK_HEIGHT = 8;

const ICON_SIZE = 18;

export interface DuelCardProps {
  readonly challenge: Challenge;
  /** Signed-in user's id, used to decide which side of the bar is "you". */
  readonly viewerId: string | null;
  readonly onAccept?: ((challengeId: string) => void) | undefined;
  readonly onDecline?: ((challengeId: string) => void) | undefined;
  readonly busy?: boolean;
  /**
   * The way into the work a running duel scores: start a session in its category, or
   * add a habit for it when there is none. Without it the card shows a race with no
   * way to run, and nothing says that the score comes from the Bugün timer.
   */
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
  /** Task duels: "I did today's task". */
  readonly onCheckIn?: ((challengeId: string) => void) | undefined;
  /** Task duels: dispute one of the opponent's check-ins. */
  readonly onDispute?: ((challengeId: string, checkInId: string) => void) | undefined;
}

/**
 * Picks the card for the duel's kind. Task duels — every duel opened now — get the
 * day board; legacy XP duels keep the race bar they were opened with.
 */
export function DuelCard(props: DuelCardProps): React.JSX.Element {
  return props.challenge.task !== null ? <TaskDuelCard {...props} /> : <XpDuelCard {...props} />;
}

function XpDuelCard({
  challenge,
  viewerId,
  onAccept,
  onDecline,
  busy = false,
  action,
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

  const leading = myXp > theirXp;
  const tied = myXp === theirXp;

  // Green means "ahead" throughout the app, so the bar turns green the moment the
  // fill passes the marker and the verdict pill agrees with it. Behind, it stays the
  // XP violet the rest of the app uses for progress — being behind is not an error.
  const leadColor = leading ? colors.success : colors.xp;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon
            name={isFinished ? 'trophy' : isPending ? 'bell' : 'flame-filled'}
            size={ICON_SIZE}
            color={
              isFinished
                ? colors.textFaint
                : isPending
                  ? colors.accent
                  : colors.fire
            }
          />
          <Text style={styles.category}>{describeCategory(challenge.category)}</Text>
        </View>
        <View style={styles.headerRight}>
          <Icon
            name="hourglass"
            size={ICON_SIZE}
            color={colors.textFaint}
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
            <Animated.View style={[styles.fill, { backgroundColor: leadColor }, fillStyle]} />
            {/* The halfway line. Crossing it is the whole message of the card, so it
                is drawn over the fill rather than behind it. */}
            <View style={styles.midMarker} pointerEvents="none" />
          </View>

          {/* The verdict, directly under the bar it judges: the one word the card
              exists to say, placed where the eye already is. */}
          <View style={styles.verdict}>
            <Icon
              name={tied ? 'minus' : leading ? 'xp-bolt-filled' : 'alert'}
              size={ICON_SIZE}
              color={tied ? colors.textMuted : leading ? colors.successDark : colors.fireDark}
            />
            <Text
              style={[
                styles.verdictText,
                { color: tied ? colors.textMuted : leading ? colors.successDark : colors.fireDark },
              ]}
            >
              {tied ? 'Berabere' : leading ? 'Öndesin' : 'Geridesin'}
            </Text>
          </View>

        </>
      )}

      {action !== undefined && !isPending && !isFinished && (
        <Button
          label={action.label}
          size="small"
          disabled={busy}
          onPress={action.onPress}
          accessibilityLabel={action.label}
          style={styles.action}
        />
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

/**
 * A task duel: the task, a row of days for each side, and today's action.
 *
 * Read as two attendance rows rather than a race: the question a player has is "did
 * I do today's, and is my friend keeping up?", and a row of days answers both at a
 * glance. A day is filled when checked in, struck when disputed, ringed when it is
 * today and still open.
 */
function TaskDuelCard({
  challenge,
  viewerId,
  onAccept,
  onDecline,
  onCheckIn,
  onDispute,
  busy = false,
}: DuelCardProps): React.JSX.Element {
  // The check-in whose dispute is armed; a second tap confirms. A dispute takes a
  // friend's point away, so it is never one tap.
  const [armed, setArmed] = useState<string | null>(null);

  const viewerIsChallenger = viewerId === null ? true : challenge.challenger.id === viewerId;
  const mine = viewerIsChallenger ? challenge.challenger : challenge.opponent;
  const theirs = viewerIsChallenger ? challenge.opponent : challenge.challenger;
  const myScore = viewerIsChallenger ? challenge.challengerXp : challenge.opponentXp;
  const theirScore = viewerIsChallenger ? challenge.opponentXp : challenge.challengerXp;

  const isPending = challenge.status === 'PENDING';
  const isActive = challenge.status === 'ACTIVE';
  const isFinished = challenge.status === 'COMPLETED';
  const days = challenge.days ?? 0;
  const today = challenge.currentDay;

  const myCheckIns = challenge.checkIns.filter((row) => row.userId === mine.id);
  const theirCheckIns = challenge.checkIns.filter((row) => row.userId === theirs.id);
  const doneToday = today !== null && myCheckIns.some((row) => row.day === today);
  // Newest first, and only what can still be disputed.
  const disputable = isActive ? [...theirCheckIns].reverse().filter((row) => !row.disputed) : [];

  const verdict = isFinished
    ? myScore > theirScore
      ? 'Kazandın'
      : myScore < theirScore
        ? 'Kaybettin'
        : 'Berabere'
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="swords" size={ICON_SIZE} color={isFinished ? colors.textFaint : colors.accent} />
          <Text style={styles.task} numberOfLines={1}>
            {challenge.task}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Icon name="hourglass" size={ICON_SIZE} color={colors.textFaint} />
          <Text style={[styles.time, isFinished && styles.timeFinished]}>
            {isFinished
              ? 'Bitti'
              : isPending
                ? `${days} gün · davet bekliyor`
                : today !== null
                  ? `${today}. gün / ${days}`
                  : formatTimeRemaining(challenge.endsAt)}
          </Text>
        </View>
      </View>

      {isPending ? (
        <Text style={styles.pendingNote}>
          {challenge.challenger.id === viewerId || viewerId === null
            ? `${theirs.displayName} davetini kabul edince düello başlar.`
            : `${theirs.displayName} seni ${days} gün boyunca her gün bu görevi yapmaya çağırıyor.`}
        </Text>
      ) : (
        <View style={styles.board}>
          <DayRow
            name="Sen"
            score={myScore}
            days={days}
            today={today}
            checkIns={myCheckIns}
            leading={myScore >= theirScore}
          />
          <DayRow
            name={theirs.displayName}
            score={theirScore}
            days={days}
            today={today}
            checkIns={theirCheckIns}
            leading={theirScore > myScore}
          />
        </View>
      )}

      {verdict !== null && <Text style={styles.verdictLine}>{verdict} · {myScore} – {theirScore} gün</Text>}

      {isActive && today !== null && onCheckIn !== undefined && (
        doneToday ? (
          <View style={styles.doneRow}>
            <Icon name="check-circle-filled" size={ICON_SIZE} color={colors.success} />
            <Text style={styles.doneText}>Bugünkü görev tamam</Text>
          </View>
        ) : (
          <Button
            label="Bugünkü görevi yaptım"
            size="small"
            disabled={busy}
            onPress={() => onCheckIn(challenge.id)}
            accessibilityLabel={`${challenge.task ?? 'Görev'} bugün yapıldı olarak işaretle`}
            style={styles.action}
          />
        )
      )}

      {onDispute !== undefined && disputable.length > 0 && (
        <View style={styles.disputeList}>
          {disputable.slice(0, 3).map((row) => (
            <View key={row.id} style={styles.disputeRow}>
              <Text style={styles.disputeText} numberOfLines={2}>
                {theirs.displayName} · {row.day}. gün yaptı
                {row.note ? ` — “${row.note}”` : ''}
              </Text>
              {armed === row.id ? (
                <ChipButton
                  label="İtirazı onayla"
                  tone="danger"
                  disabled={busy}
                  onPress={() => {
                    setArmed(null);
                    onDispute(challenge.id, row.id);
                  }}
                  accessibilityLabel={`${row.day}. gün işaretine itirazı onayla`}
                />
              ) : (
                <Pressable
                  onPress={() => setArmed(row.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${theirs.displayName} ${row.day}. gün işaretine itiraz et`}
                >
                  <Text style={styles.disputeLink}>İtiraz et</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {isPending && challenge.opponent.id === viewerId && (onAccept !== undefined || onDecline !== undefined) && (
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

/** One side's attendance: name, a dot per day, and the score. */
function DayRow({
  name,
  score,
  days,
  today,
  checkIns,
  leading,
}: {
  readonly name: string;
  readonly score: number;
  readonly days: number;
  readonly today: number | null;
  readonly checkIns: readonly CheckIn[];
  readonly leading: boolean;
}): React.JSX.Element {
  const byDay = new Map(checkIns.map((row) => [row.day, row]));
  return (
    <View
      style={styles.dayRow}
      accessible
      accessibilityLabel={`${name}: ${score} / ${days} gün`}
    >
      <Text style={styles.dayRowName} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.dots}>
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const row = byDay.get(day);
          const isToday = today === day;
          const past = today === null || day < today;
          return (
            <View
              key={day}
              style={[
                styles.dot,
                row && !row.disputed && styles.dotDone,
                row?.disputed && styles.dotDisputed,
                !row && isToday && styles.dotToday,
                !row && !isToday && !past && styles.dotFuture,
              ]}
            >
              {row && !row.disputed && <Icon name="check-circle-filled" size={12} color={colors.textOnAccent} />}
              {row?.disputed && <Icon name="x" size={10} color={colors.danger} />}
            </View>
          );
        })}
      </View>
      <Text style={[styles.dayRowScore, leading && score > 0 && styles.dayRowScoreLeading]}>
        {score}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.sm },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  category: { ...type.label, color: colors.textMuted },
  time: { ...type.caption, color: colors.textMuted },
  timeFinished: { color: colors.textFaint },

  names: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },

  scoreboard: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  side: { flex: 1, gap: 2 },
  sideRight: { flex: 1, gap: 2, alignItems: 'flex-end' },
  nameMine: { ...type.label, color: colors.text, flex: 1 },
  nameTheirs: { ...type.label, color: colors.textMuted, flex: 1, textAlign: 'right' },
  score: { ...type.display, color: colors.text },
  scoreTheirs: { color: colors.textMuted },
  /** The unit, stated once between the two numbers instead of after each. */
  versus: { ...type.caption, color: colors.textFaint, paddingBottom: spacing.sm },

  pendingNote: { ...type.body, color: colors.textMuted },

  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    // A fill at 0% must not show a rounded stub of colour.
    minWidth: 0,
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
    backgroundColor: colors.surface,
  },

  verdict: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  verdictText: { ...type.label },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { marginTop: spacing.xs },

  task: { ...type.heading, color: colors.text, flexShrink: 1 },
  board: { gap: spacing.sm, marginTop: spacing.xs },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayRowName: { ...type.label, color: colors.text, width: 76 },
  dots: { flex: 1, flexDirection: 'row', gap: spacing.xs },
  dot: {
    flex: 1,
    maxWidth: 36,
    height: 22,
    borderRadius: radius.sm - 2,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.success },
  dotDisputed: { backgroundColor: colors.dangerSoft },
  // Today, still open: the one cell that earns an edge, as on the streak calendar.
  dotToday: { borderWidth: 2, borderColor: colors.accent },
  dotFuture: { opacity: 0.5 },
  dayRowScore: { ...type.heading, color: colors.textMuted, width: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
  dayRowScoreLeading: { color: colors.text },
  verdictLine: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs },
  doneText: { ...type.label, color: colors.successDark },
  disputeList: { gap: spacing.xs, marginTop: spacing.xs },
  disputeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disputeText: { ...type.caption, color: colors.textMuted, flex: 1 },
  disputeLink: { ...type.label, color: colors.danger },
  actionButton: { flex: 1 },
});
