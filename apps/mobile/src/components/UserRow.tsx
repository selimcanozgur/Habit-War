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
}: UserRowProps): React.JSX.Element {
  const descriptor = [`Seviye ${user.level}`, describeClass(user.classType)].join(' · ');

  const body = (
    <>
      {leading}

      <View style={styles.avatar}>
        {user.avatarUrl !== null ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitials}>{initialsOf(user)}</Text>
        )}
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

const AVATAR_SIZE = 40;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHighlighted: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  rowPressed: { opacity: 0.7 },

  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarInitials: { ...type.label, color: colors.textMuted },

  text: { flex: 1, gap: 2 },
  name: { ...type.heading, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },

  trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
