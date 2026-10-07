/**
 * The character banner: who you are and how far along.
 *
 * It heads Bugün, because the app's premise is that habits build a character, so the
 * character has to be the first thing on the screen where habits are recorded.
 *
 * Kept short on purpose: name, title, level with its bar, and the day streak — the one
 * number a player protects daily. Everything else (stat points, total XP) lives on the
 * profile; here it would push the mission card, the thing to do now, below the fold.
 *
 * Everything is laid over the illustration rather than on a panel above it: the
 * character and their progress are one object.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, heroHeight, radius, spacing, type } from '../theme';
import { Icon } from './Icon';
import { ScreenHero, type HeroImage } from './ScreenHero';
import { XpBar } from './XpBar';

const ICON_SIZE = 20;

export interface CharacterHeaderProps {
  readonly image: HeroImage;
  /** Display name, already resolved from displayName/username by the caller. */
  readonly name: string;
  /** The class line under the name, e.g. "Zanaatkâr". */
  readonly className: string;
  readonly level: number;
  /** 0..1 within the current level. */
  readonly ratio: number;
  readonly xpIntoLevel: number;
  /** 0 at max level, which the bar renders as "Azami seviye". */
  readonly xpForNextLevel: number;
  /** Consecutive days with a session; the chip is hidden at zero. */
  readonly streak: number;
  readonly avatarUrl?: string | null;
  /** Ascension count; the chip is hidden at zero. */
  readonly prestige?: number;
  /** Top-right affordance, e.g. the profile's settings gear. */
  readonly action?: React.ReactNode;
}

export function CharacterHeader({
  image,
  name,
  className,
  level,
  ratio,
  xpIntoLevel,
  xpForNextLevel,
  streak,
  avatarUrl = null,
  prestige = 0,
  action,
}: CharacterHeaderProps): React.JSX.Element {
  return (
    <ScreenHero
      image={image}
      title={name}
      subtitle={className}
      height={heroHeight + 40}
      grows
      action={action}
    >
      {/*
        The uploaded photo, when there is one. The comp has no avatar disc — the
        illustration is the character — so an initials circle would add a placeholder
        the design never asked for. A real photo is different: it is the user's own
        choice and has to appear somewhere.
      */}
      {(avatarUrl !== null || prestige > 0) && (
        <View style={styles.chips}>
          {avatarUrl !== null && (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              accessibilityLabel={`${name} profil fotoğrafı`}
            />
          )}
          {prestige > 0 && (
            <View style={styles.prestigeChip}>
              <Icon name="trophy" size={ICON_SIZE - 6} color={colors.textOnAccent} />
              <Text style={styles.prestigeChipText}>{prestige}. yükseliş</Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.progress}>
        <View style={styles.levelRow}>
          <Text style={styles.level}>Seviye {level}</Text>
          {streak > 0 && (
            <View
              style={styles.streak}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${streak} günlük seri`}
            >
              <Icon name="flame-filled" size={ICON_SIZE - 6} color={colors.fire} />
              <Text style={styles.streakText}>{streak} gün seri</Text>
            </View>
          )}
        </View>
        <XpBar
          ratio={ratio}
          level={level}
          xpIntoLevel={xpIntoLevel}
          xpForNextLevel={xpForNextLevel}
          compact
          onDark
        />
      </View>
    </ScreenHero>
  );
}

const AVATAR_SIZE = 52;

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.textOnDark,
  },
  prestigeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.xp,
  },
  prestigeChipText: { ...type.caption, color: colors.textOnAccent },

  progress: { gap: spacing.xs },
  level: {
    ...type.heading,
    color: colors.textOnDark,
    textShadowColor: 'rgba(20, 19, 15, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },

  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  streakText: { ...type.caption, fontFamily: 'Nunito_800ExtraBold', color: colors.textOnDark },
});
