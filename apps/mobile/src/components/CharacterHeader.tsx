/**
 * The character banner: who you are, how far along, and what you are carrying.
 *
 * It heads both the Bugün screen and the profile, because the comp puts the same
 * object at the top of each. That is the right call rather than a duplication: the
 * app's premise is that habits build a character, so the character has to be the
 * first thing on the screen where habits are recorded — not a page you navigate to.
 *
 * Everything is laid over the illustration rather than on a panel above it. A pale
 * strip carrying the bar would read as a patch taped onto the artwork; the point is
 * that the character and their progress are one object.
 *
 * The three standing badges are a translucent material over the scene rather than
 * opaque panels: they belong to the illustration, like the name above them, and an
 * opaque slab with a frame would cut three holes in the artwork.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, heroHeightTall, radius, spacing, type } from '../theme';
import { Icon, type IconName } from './Icon';
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
  readonly streak: number;
  readonly xp: number;
  readonly statPoints: number;
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
  xp,
  statPoints,
  avatarUrl = null,
  prestige = 0,
  action,
}: CharacterHeaderProps): React.JSX.Element {
  return (
    <ScreenHero
      image={image}
      title={name}
      subtitle={className}
      height={heroHeightTall}
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
        <Text style={styles.level}>Seviye {level}</Text>
        <XpBar
          ratio={ratio}
          level={level}
          xpIntoLevel={xpIntoLevel}
          xpForNextLevel={xpForNextLevel}
          compact
          onDark
        />
      </View>

      <Animated.View entering={FadeInDown.duration(320)} style={styles.badgeRow}>
        <StandingBadge
          icon="flame-filled"
          tint={colors.fire}
          value={`${streak}`}
          label="Gün Serisi"
        />
        <StandingBadge icon="xp-bolt-filled" tint={colors.xp} value={`${xp}`} label="XP" />
        <StandingBadge
          icon="star-filled"
          tint={colors.gold}
          value={`${statPoints}`}
          label="Puan"
        />
      </Animated.View>
    </ScreenHero>
  );
}

/**
 * One of the three dark badges.
 *
 * The figure leads and the word beneath it is demoted to an overline — at a glance
 * the number is what the user is checking, and the label only says which number.
 */
function StandingBadge({
  icon,
  tint,
  value,
  label,
}: {
  readonly icon: IconName;
  readonly tint: string;
  readonly value: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <View
      style={styles.badge}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Icon name={icon} size={ICON_SIZE} color={tint} />
      <Text style={styles.badgeValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.badgeLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
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

  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  badge: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    // A light material over the scrim: lifts the figures off the art without
    // painting an opaque panel over it.
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  badgeValue: { ...type.title, color: colors.textOnDark, fontVariant: ['tabular-nums'] },
  badgeLabel: {
    ...type.caption,
    color: colors.textOnDark,
    opacity: 0.8,
    textAlign: 'center',
  },
});
