/**
 * The payoff after logging pages: XP gained, and whichever moments this log caused —
 * the daily goal reached, a book defeated, a level gained.
 *
 * This is the reward step of the habit loop, so it names exactly what the reader did
 * and nothing else. Celebrating things that did not happen would teach them that the
 * celebration means nothing.
 */

import { DAILY_GOAL_BONUS_XP } from '@habitwar/domain';
import { StyleSheet, Text, View } from 'react-native';

import type { LogResult } from '../api/reading';
import { useT } from '../i18n';
import { colors, radius, spacing, type } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { XpBar } from './XpBar';

export interface RewardSheetProps {
  readonly result: LogResult | null;
  readonly onClose: () => void;
}

function Moment({ icon, tint, text }: { icon: IconName; tint: string; text: string }) {
  return (
    <View style={styles.moment}>
      <Icon name={icon} size={20} color={tint} />
      <Text style={styles.momentText}>{text}</Text>
    </View>
  );
}

export function RewardSheet({ result, onClose }: RewardSheetProps): React.JSX.Element {
  const t = useT();

  return (
    <Sheet visible={result !== null} title={result ? t.reward.xp(result.score.xp) : ''} onClose={onClose}>
      {result ? (
        <>
          <XpBar
            ratio={result.level.progress.ratio}
            level={result.level.progress.level}
            xpIntoLevel={result.level.progress.xpIntoLevel}
            xpForNextLevel={result.level.progress.xpForNextLevel}
            leveledUp={result.level.leveledUp}
          />
          <View style={styles.moments}>
            {result.level.leveledUp ? (
              <Moment icon="star-filled" tint={colors.goldDark} text={t.reward.levelUp(result.level.toLevel)} />
            ) : null}
            {result.book.progress.defeated ? (
              <Moment icon="trophy" tint={colors.goldDark} text={t.reward.bookDefeated(result.book.title)} />
            ) : null}
            {result.score.goalReachedNow ? (
              <Moment
                icon="check-circle-filled"
                tint={colors.success}
                text={t.reward.goalReached(DAILY_GOAL_BONUS_XP)}
              />
            ) : null}
            <Moment icon="flame-filled" tint={colors.fire} text={t.reward.streak(result.streak.current)} />
          </View>
          <Button label={t.common.continue} onPress={onClose} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  moments: { gap: spacing.sm },
  moment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  momentText: { ...type.label, color: colors.text, flex: 1 },
});
