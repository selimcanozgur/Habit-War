/**
 * One person, rendered as a row.
 *
 * Used by the friend list, the search results, both request queues and the duel
 * opponent picker. Keeping a single row component means a friend looks like the
 * same person everywhere they appear — the avatar, the level and the name never
 * shift position between screens.
 *
 * Trailing content is a slot rather than a set of props: the accept/decline pair,
 * the single "Ekle" button and the plain streak label have nothing in common
 * beyond their position, and modelling them as variants would only grow.
 *
 * Visually the row is a list row, not a card: it has no fill or edge of its own and
 * is meant to sit inside a `Group`, which supplies the card and the separators.
 * `USER_ROW_INSET` is where that separator should start for a row without a
 * leading slot.
 */

import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeClass } from '../api/profile';
import type { SocialUser } from '../api/social';
import { colors, radius, spacing, type } from '../theme';

export interface UserRowProps {
  readonly user: SocialUser;
  /** Extra line under the name, e.g. "7 günlük seri". */
  readonly subtitle?: string | undefined;
  /** Buttons or a label pinned to the right edge. */
  readonly trailing?: React.ReactNode;
  readonly onPress?: (() => void) | undefined;
  /** Marks the signed-in user's own row so it reads as "you" in a list. */
  readonly highlighted?: boolean;
  /** Rank badge, shown in place of nothing on leaderboard rows. */
  readonly leading?: React.ReactNode;
  /**
   * Draws the small presence dot on the avatar, as the friend list does.
   * Purely decorative — the meta line still carries every fact in text.
   */
  readonly showPresence?: boolean;
}

/** Initials, for the common case of a user with no uploaded avatar. */
function initialsOf(user: SocialUser): string {
  const source = user.displayName.trim() || user.username.trim();
  if (source === '') return '?';
  const words = source.split(/\s+/).filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

function UserRowInner({
  user,
  subtitle,
  trailing,
  onPress,
  highlighted = false,
  leading,
  showPresence = false,
}: UserRowProps): React.JSX.Element {
  const descriptor = [`Seviye ${user.level}`, describeClass(user.classType)].join(' · ');

  const body = (
    <>
      {leading}

      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          {user.avatarUrl !== null ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitials}>{initialsOf(user)}</Text>
          )}
        </View>
        {showPresence ? <View style={styles.presenceDot} pointerEvents="none" /> : null}
      </View>

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {user.classType !== null ? descriptor : `Seviye ${user.level}`}
          {subtitle !== undefined && subtitle !== '' ? ` · ${subtitle}` : ''}
        </Text>
      </View>

      {trailing !== undefined && <View style={styles.trailing}>{trailing}</View>}
    </>
  );

  // A row with no tap target must not be a Pressable: an inert button confuses
  // screen readers and swallows the child buttons' own accessibility roles.
  if (onPress === undefined) {
    return <View style={[styles.row, highlighted && styles.rowHighlighted]}>{body}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        highlighted && styles.rowHighlighted,
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${user.displayName}, seviye ${user.level}`}
    >
      {body}
    </Pressable>
  );
}

export const UserRow = memo(UserRowInner);

/** Where a `Group` separator starts under a row with no leading slot: past the avatar. */
export const USER_ROW_INSET = spacing.md + 40 + spacing.md;

const AVATAR_SIZE = 40;
/** Large enough to register at a glance, small enough not to crop the avatar. */
const PRESENCE_SIZE = 12;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // "You" in a list: a soft wash rather than an outline. The rank and name still say
  // it in text, so the wash is a cue, not the only signal.
  rowHighlighted: { backgroundColor: colors.goldSoft },
  rowPressed: { backgroundColor: colors.surfaceRaised },

  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Sits on the avatar's lower-right, ringed in the card colour so it reads as an
  // object on top of the photo rather than a spot of dirt in it.
  presenceDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: PRESENCE_SIZE,
    height: PRESENCE_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarImage: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarInitials: { ...type.label, color: colors.textMuted },

  // `minWidth` is a floor, not a preference. Without it a row carrying two trailing
  // chips — the accept/decline pair — let the chips take their full intrinsic width
  // first, and "Zeynep Arslan" rendered as "Zeynep Ars...". A name clipped mid-word
  // is worse than a slightly narrower button, because the name is the row's subject.
  text: { flex: 1, minWidth: 116, gap: 2 },
  name: { ...type.heading, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },

  // Shrinks before the name does, and tightens the gap it owns rather than the
  // chips' own padding, so the labels stay whole while the group gives ground.
  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
});
