/**
 * The badge shelf.
 *
 * Locked badges are shown, not hidden. A shelf of only what you already have is a
 * receipt; a shelf that also shows what is within reach is a goal. They are dimmed
 * and desaturated rather than removed, and their description stays readable so the
 * user can see how to earn them — a locked badge with a hidden description is just
 * a grey square.
 *
 * Earned badges are sorted first, then by tier descending, so the shelf leads with
 * the user's best work.
 */

import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Achievement, AchievementTier } from '../api/profile';
import { colors, radius, spacing, type } from '../theme';

/** Tier accent colours, reusing theme tokens rather than inventing metal shades. */
const TIER_COLORS: Readonly<Record<AchievementTier, string>> = {
  BRONZE: colors.warning,
  SILVER: colors.textMuted,
  GOLD: colors.accentBright,
  PLATINUM: colors.success,
};

const TIER_LABELS: Readonly<Record<AchievementTier, string>> = {
  BRONZE: 'Bronz',
  SILVER: 'Gümüş',
  GOLD: 'Altın',
  PLATINUM: 'Platin',
};

/** Higher sorts first. Unknown tiers fall to the bottom rather than throwing. */
const TIER_RANK: Readonly<Record<AchievementTier, number>> = {
  PLATINUM: 4,
  GOLD: 3,
  SILVER: 2,
  BRONZE: 1,
};

function tierOf(raw: string): AchievementTier | null {
  return raw in TIER_COLORS ? (raw as AchievementTier) : null;
}

export interface AchievementShelfProps {
  readonly achievements: readonly Achievement[];
}

export function AchievementShelf({ achievements }: AchievementShelfProps): React.JSX.Element {
  // Which badge's detail is expanded. Tapping is the only way to read a long
  // description without letting every card grow to fit its worst case.
  const [openId, setOpenId] = useState<string | null>(null);

  const earnedCount = achievements.filter((item) => item.earnedAt !== null).length;

  if (achievements.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Rozetler</Text>
        </View>
        <Text style={styles.empty}>
          Henüz rozet tanımlanmadı. Seanslarını tamamlamaya devam et; kazandıkların burada
          birikecek.
        </Text>
      </View>
    );
  }

  const sorted = [...achievements].sort((a, b) => {
    const earnedDiff = Number(b.earnedAt !== null) - Number(a.earnedAt !== null);
    if (earnedDiff !== 0) return earnedDiff;
    const rankDiff = rankOf(b.tier) - rankOf(a.tier);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, 'tr');
  });

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Rozetler</Text>
        <Text style={styles.counter}>
          {earnedCount} / {achievements.length}
        </Text>
      </View>

      <View style={styles.grid}>
        {sorted.map((item) => {
          const earned = item.earnedAt !== null;
          const tier = tierOf(item.tier);
          const accent = tier ? TIER_COLORS[tier] : colors.textMuted;
          const isOpen = openId === item.id;

          return (
            <Pressable
              key={item.id}
              style={[styles.badge, earned ? { borderColor: accent } : styles.badgeLocked]}
              onPress={() => {
                void Haptics.selectionAsync();
                setOpenId(isOpen ? null : item.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                earned
                  ? `${item.name} rozeti kazanıldı. ${item.description}`
                  : `${item.name} rozeti kilitli. ${item.description}`
              }
              accessibilityState={{ expanded: isOpen }}
            >
              <View
                style={[
                  styles.medal,
                  { borderColor: accent },
                  earned ? { backgroundColor: accent } : styles.medalLocked,
                ]}
              >
                <Text style={[styles.medalText, earned ? styles.medalTextEarned : { color: accent }]}>
                  {initialsOf(item.name)}
                </Text>
              </View>

              <Text
                style={[styles.badgeName, !earned && styles.lockedText]}
                numberOfLines={2}
              >
                {item.name}
              </Text>

              <Text style={[styles.badgeTier, { color: earned ? accent : colors.textFaint }]}>
                {earned ? (tier ? TIER_LABELS[tier] : item.tier) : 'Kilitli'}
              </Text>

              {isOpen && (
                <Animated.Text entering={FadeIn.duration(160)} style={styles.badgeDescription}>
                  {item.description}
                  {earned && item.earnedAt ? `\n${formatEarnedAt(item.earnedAt)}` : ''}
                </Animated.Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function rankOf(raw: string): number {
  const tier = tierOf(raw);
  return tier ? TIER_RANK[tier] : 0;
}

/** Up to two initials — a stand-in until the badge artwork exists. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return (first + second).toLocaleUpperCase('tr-TR');
}

/** Defensive: an unparseable timestamp must not blank the card. */
function formatEarnedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString('tr-TR')} tarihinde kazanıldı`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { ...type.heading, color: colors.text },
  counter: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  empty: { ...type.body, color: colors.textFaint, lineHeight: 21 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    // Three per row at phone widths, and the cards reflow rather than clip on wider
    // screens. Percentages keep that working without measuring the container.
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  // Dimmed, not removed: the user should see what is still ahead of them.
  badgeLocked: { opacity: 0.45, borderStyle: 'dashed' },

  medal: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalLocked: { backgroundColor: 'transparent' },
  medalText: { ...type.label, fontWeight: '700' },
  medalTextEarned: { color: colors.bg },

  badgeName: { ...type.caption, color: colors.text, textAlign: 'center' },
  lockedText: { color: colors.textMuted },
  badgeTier: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeDescription: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 15,
  },
});
