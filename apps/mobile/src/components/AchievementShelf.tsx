/**
 * The badge shelf.
 *
 * Locked badges are shown, not hidden. A shelf of only what you already have is a
 * receipt; a shelf that also shows what is within reach is a goal. Their description
 * stays readable so the user can see how to earn them — a locked badge with a hidden
 * description is just a grey square.
 *
 * Earned and locked are separated by more than opacity, which on a white ground is
 * only a faint grey wash and reads as "still loading". An earned badge is a white
 * card with a solid tier-coloured outline and a filled medal; a locked one is sunken
 * into the page behind a dashed outline, with a padlock where the medal would be. The
 * difference survives a screenshot, a bright screen, and colour blindness.
 *
 * Earned badges are sorted first, then by tier descending, so the shelf leads with
 * the user's best work.
 *
 * Badge names come from the backend and are rendered verbatim — they are not this
 * component's copy to translate.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { Achievement, AchievementTier } from '../api/profile';
import { colors, radius, spacing, type } from '../theme';
import { cardStyle } from './Button';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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

/**
 * Tier glyphs.
 *
 * A real icon per tier rather than the badge's initials: initials of a
 * backend-supplied English name carry no meaning at 44px, whereas the escalating
 * ribbon → medal → trophy → diamond sequence tells the user which tier they are
 * looking at without reading anything.
 */
const TIER_ICONS: Readonly<Record<AchievementTier, IoniconName>> = {
  BRONZE: 'ribbon',
  SILVER: 'medal',
  GOLD: 'trophy',
  PLATINUM: 'diamond',
};

/** Higher sorts first. Unknown tiers fall to the bottom rather than throwing. */
const TIER_RANK: Readonly<Record<AchievementTier, number>> = {
  PLATINUM: 4,
  GOLD: 3,
  SILVER: 2,
  BRONZE: 1,
};

const MEDAL_ICON_SIZE = 22;

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
        {/* How many are earned is the card's headline number; the total is context. */}
        <View style={styles.counterGroup}>
          <Text style={styles.counterEarned}>{earnedCount}</Text>
          <Text style={styles.counterTotal}>/ {achievements.length}</Text>
        </View>
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
                  earned
                    ? { backgroundColor: accent, borderColor: accent }
                    : styles.medalLocked,
                ]}
              >
                <Ionicons
                  name={earned ? (tier ? TIER_ICONS[tier] : 'ribbon') : 'lock-closed'}
                  size={MEDAL_ICON_SIZE}
                  color={earned ? colors.textOnAccent : colors.textFaint}
                />
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

/** Defensive: an unparseable timestamp must not blank the card. */
function formatEarnedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString('tr-TR')} tarihinde kazanıldı`;
}

const styles = StyleSheet.create({
  container: { ...cardStyle, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },
  counterGroup: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  counterEarned: { ...type.display, color: colors.text },
  counterTotal: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
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
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Sunken and dashed, not merely dimmed: the user should read "not yet" rather than
  // "not loaded", and the description must stay legible.
  badgeLocked: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },

  medal: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalLocked: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },

  badgeName: { ...type.caption, color: colors.text, textAlign: 'center' },
  lockedText: { color: colors.textMuted },
  badgeTier: { ...type.overline, textTransform: 'uppercase' },
  badgeDescription: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 15,
  },
});
