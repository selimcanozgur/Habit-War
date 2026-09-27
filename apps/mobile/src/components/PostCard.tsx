/**
 * One feed post.
 *
 * The card's job is to make post *kind* legible at a glance, because the feed mixes
 * machine-generated and human posts and they carry very different weight:
 *
 *  - `DAILY_DIGEST` is the spec's anti-spam default (§5.1): a whole day rolled into
 *    one row — "Selimcan bugün 3 seans, 145 XP". It renders as a stat strip, since
 *    the numbers are the content.
 *  - `SESSION_COMPLETE` is a single session the user chose to share — "30 dk okudu,
 *    +42 XP". It renders as one inline line, deliberately quieter than a digest so a
 *    shared session never out-shouts a day's work.
 *  - `LEVEL_UP` and `ACHIEVEMENT` are celebrations: accent-tinted, badge-led.
 *  - Everything else is plain text, which is what an unknown future type degrades to.
 *
 * Moderation is not optional here. App Store guideline 1.2 requires a report and a
 * block path on any user-generated content feed, so every single card exposes both —
 * via the ⋯ button and via long-press, since users reach for either.
 */

import * as Haptics from 'expo-haptics';
import { memo, useCallback, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { formatRelativeTime, type Post, type ReportReason } from '../api/feed';
import { colors, radius, spacing, type } from '../theme';

export interface PostCardProps {
  readonly post: Post;
  /** Fires on tap and on the optimistic path; the screen owns the mutation. */
  readonly onToggleLike: (post: Post) => void;
  readonly onReport: (post: Post, reason: ReportReason) => void;
  readonly onBlock: (post: Post) => void;
}

/** Reason codes paired with the Turkish label shown in the action sheet. */
const REPORT_REASONS: readonly { readonly code: ReportReason; readonly label: string }[] = [
  { code: 'SPAM', label: 'Spam veya yanıltıcı' },
  { code: 'HARASSMENT', label: 'Taciz veya zorbalık' },
  { code: 'HATE', label: 'Nefret söylemi' },
  { code: 'SEXUAL', label: 'Cinsel içerik' },
  { code: 'VIOLENCE', label: 'Şiddet' },
  { code: 'OTHER', label: 'Diğer' },
];

function PostCardImpl({ post, onToggleLike, onReport, onBlock }: PostCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const heartScale = useSharedValue(1);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  const handleLike = useCallback(() => {
    // Haptic fires before the network call: the tap should feel answered instantly,
    // and the screen rolls the count back if the request later fails.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Squash then spring back. A rapid double-tap re-targets the spring rather than
    // queueing animations, so the heart never lags behind the finger.
    heartScale.value = withSequence(
      withTiming(0.82, { duration: 90 }),
      withSpring(1, { damping: 8, stiffness: 240 }),
    );
    onToggleLike(post);
  }, [heartScale, onToggleLike, post]);

  const openReportSheet = useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      'Gönderiyi şikayet et',
      'Bu gönderiyi neden bildiriyorsun?',
      [
        ...REPORT_REASONS.map((reason) => ({
          text: reason.label,
          onPress: () => onReport(post, reason.code),
        })),
        { text: 'Vazgeç', style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [onReport, post]);

  const confirmBlock = useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      `@${post.author.username} engellensin mi?`,
      'Bu kişinin gönderilerini görmezsin ve sana ulaşamaz. Bu işlemi ayarlardan geri alabilirsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Engelle', style: 'destructive', onPress: () => onBlock(post) },
      ],
    );
  }, [onBlock, post]);

  const toggleMenu = useCallback(() => {
    void Haptics.selectionAsync();
    setMenuOpen((open) => !open);
  }, []);

  const initial = (post.author.displayName.trim()[0] ?? '?').toLocaleUpperCase('tr-TR');

  return (
    <Animated.View style={[styles.card, isCelebration(post.type) && styles.cardCelebration]}>
      {/* Long-press anywhere on the body is the second route to moderation. */}
      <Pressable
        onLongPress={toggleMenu}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${post.author.displayName} gönderisi. Seçenekler için uzun bas.`}
      >
        <View style={styles.header}>
          {post.author.avatarUrl ? (
            <Image source={{ uri: post.author.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}

          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {post.author.displayName}
              </Text>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>Sv {post.author.level}</Text>
              </View>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              @{post.author.username} · {formatRelativeTime(post.createdAt)}
            </Text>
          </View>

          <Pressable
            onPress={toggleMenu}
            hitSlop={12}
            style={styles.menuButton}
            accessibilityRole="button"
            accessibilityLabel="Gönderi seçenekleri"
          >
            <Text style={styles.menuGlyph}>⋯</Text>
          </Pressable>
        </View>

        <PostBody post={post} />
      </Pressable>

      {menuOpen && (
        <View style={styles.menu}>
          <Pressable
            onPress={openReportSheet}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel="Gönderiyi şikayet et"
          >
            <Text style={styles.menuItemText}>Şikayet et</Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable
            onPress={confirmBlock}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel={`${post.author.displayName} kullanıcısını engelle`}
          >
            <Text style={[styles.menuItemText, styles.menuItemDanger]}>
              @{post.author.username} kullanıcısını engelle
            </Text>
          </Pressable>
          <View style={styles.menuDivider} />
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel="Menüyü kapat"
          >
            <Text style={[styles.menuItemText, styles.menuItemMuted]}>Vazgeç</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={handleLike}
          hitSlop={8}
          style={styles.footerAction}
          accessibilityRole="button"
          accessibilityState={{ selected: post.likedByMe }}
          accessibilityLabel={
            post.likedByMe
              ? `Beğeniyi geri al. ${post.likeCount} beğeni.`
              : `Beğen. ${post.likeCount} beğeni.`
          }
        >
          <Animated.Text
            style={[styles.footerIcon, post.likedByMe && styles.footerIconLiked, heartStyle]}
          >
            {post.likedByMe ? '♥' : '♡'}
          </Animated.Text>
          <Text style={[styles.footerCount, post.likedByMe && styles.footerCountLiked]}>
            {post.likeCount}
          </Text>
        </Pressable>

        <View
          style={styles.footerAction}
          accessibilityRole="text"
          accessibilityLabel={`${post.replyCount} yorum`}
        >
          <Text style={styles.footerIcon}>💬</Text>
          <Text style={styles.footerCount}>{post.replyCount}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

/** Level-ups and achievements get the tinted treatment. */
function isCelebration(postType: Post['type']): boolean {
  return postType === 'LEVEL_UP' || postType === 'ACHIEVEMENT';
}

/**
 * The type-specific middle of the card.
 *
 * Split out so the header/footer chrome stays identical across kinds — the variation
 * the user should notice is the content, not the frame.
 */
function PostBody({ post }: { readonly post: Post }): React.JSX.Element {
  switch (post.type) {
    case 'DAILY_DIGEST': {
      const stats = post.digestStats;
      return (
        <View style={styles.body}>
          <Text style={styles.digestHeadline}>
            {post.author.displayName} {digestDayLabel(post.digestDate)}{' '}
            {stats ? `${stats.sessionCount} seans tamamladı` : 'çalıştı'}
          </Text>

          {stats && (
            <View style={styles.statStrip}>
              <StatChip value={`${stats.sessionCount}`} label="seans" />
              <StatChip value={`${stats.totalMinutes}`} label="dakika" />
              <StatChip value={`+${stats.totalXp}`} label="XP" highlight />
            </View>
          )}

          {/*
            `topHabitName` is never populated — the API sends the day's categories, not
            a headline habit — so the footnote reads from what actually arrives and
            falls back to the habit name only if a future payload provides one.
          */}
          {stats?.topHabitName ? (
            <Text style={styles.digestFootnote}>En çok: {stats.topHabitName}</Text>
          ) : stats && stats.categories.length > 0 ? (
            <Text style={styles.digestFootnote}>
              {stats.categories.map(categoryLabel).join(' · ')}
            </Text>
          ) : null}

          {post.content.length > 0 && <Text style={styles.content}>{post.content}</Text>}
        </View>
      );
    }

    case 'SESSION_COMPLETE': {
      const session = post.sessionStats;
      // One session, one line. The digest above is the loud format; this stays small.
      const parts: string[] = [];
      if (session?.durationMinutes !== undefined) parts.push(`${session.durationMinutes} dk`);
      if (session?.habitName) parts.push(session.habitName);
      const summary = parts.length > 0 ? parts.join(' ') : 'Bir seans tamamlandı';

      return (
        <View style={styles.body}>
          <View style={styles.sessionRow}>
            <Text style={styles.sessionIcon}>⏱</Text>
            <Text style={styles.sessionText} numberOfLines={2}>
              {summary}
            </Text>
            {session?.xp !== undefined && <Text style={styles.sessionXp}>+{session.xp} XP</Text>}
          </View>
          {post.content.length > 0 && <Text style={styles.content}>{post.content}</Text>}
        </View>
      );
    }

    case 'LEVEL_UP':
      return (
        <View style={styles.body}>
          <View style={styles.celebrationRow}>
            <Text style={styles.celebrationGlyph}>⬆️</Text>
            <Text style={styles.celebrationText}>
              {post.level !== undefined
                ? `Seviye ${post.level}'e yükseldi!`
                : 'Seviye atladı!'}
            </Text>
          </View>
          {post.content.length > 0 && <Text style={styles.content}>{post.content}</Text>}
        </View>
      );

    case 'ACHIEVEMENT':
      return (
        <View style={styles.body}>
          <View style={styles.celebrationRow}>
            <Text style={styles.celebrationGlyph}>🏅</Text>
            <Text style={styles.celebrationText}>
              {post.achievementName
                ? `"${post.achievementName}" rozetini kazandı!`
                : 'Yeni bir rozet kazandı!'}
            </Text>
          </View>
          {post.content.length > 0 && <Text style={styles.content}>{post.content}</Text>}
        </View>
      );

    case 'CHALLENGE_RESULT':
      return (
        <View style={styles.body}>
          <View style={styles.duelRow}>
            <Text style={styles.duelLabel}>DÜELLO SONUCU</Text>
          </View>
          <Text style={styles.content}>{post.content || 'Bir düello tamamlandı.'}</Text>
        </View>
      );

    case 'IMAGE':
    case 'TEXT':
    default:
      return (
        <View style={styles.body}>
          {post.content.length > 0 && <Text style={styles.content}>{post.content}</Text>}
          {post.mediaUrls[0] !== undefined && (
            <Image
              source={{ uri: post.mediaUrls[0] }}
              style={styles.media}
              accessibilityLabel="Gönderi görseli"
            />
          )}
        </View>
      );
  }
}

function StatChip({
  value,
  label,
  highlight = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly highlight?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.statChip}>
      <Text style={[styles.statChipValue, highlight && styles.statChipValueHighlight]}>{value}</Text>
      <Text style={styles.statChipLabel}>{label}</Text>
    </View>
  );
}

/** Turkish labels for the API's category enum. */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  FITNESS: 'Spor',
  STUDY: 'Ders',
  MINDFULNESS: 'Zihin',
  CREATIVE: 'Yaratıcılık',
  SOCIAL: 'Sosyal',
  HEALTH: 'Sağlık',
  SKILL: 'Beceri',
};

/** Falls through to the raw value so an enum added server-side still renders. */
function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** "bugün" / "dün" reads far better than a date on a digest headline. */
function digestDayLabel(digestDate: string | undefined): string {
  if (!digestDate) return 'bugün';
  const parsed = new Date(`${digestDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'bugün';

  const today = new Date();
  const dayMs = 86_400_000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((startOfToday - parsed.getTime()) / dayMs);

  if (diffDays <= 0) return 'bugün';
  if (diffDays === 1) return 'dün';
  return parsed.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) + '’de';
}

/** Feed lists get long; re-rendering untouched cards on every page append is waste. */
export const PostCard = memo(PostCardImpl);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardCelebration: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...type.heading, color: colors.textMuted },
  headerText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  displayName: { ...type.heading, color: colors.text, flexShrink: 1 },
  levelBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  levelBadgeText: { ...type.caption, color: '#FFFFFF' },
  meta: { ...type.caption, color: colors.textFaint },
  menuButton: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  menuGlyph: { ...type.heading, color: colors.textMuted },

  body: { gap: spacing.sm },
  content: { ...type.body, color: colors.text, lineHeight: 21 },
  media: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },

  digestHeadline: { ...type.body, color: colors.text, fontWeight: '600' },
  digestFootnote: { ...type.caption, color: colors.textMuted },
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  statChip: { flex: 1, alignItems: 'center', gap: 2 },
  statChipValue: { ...type.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  statChipValueHighlight: { color: colors.success },
  statChipLabel: { ...type.caption, color: colors.textFaint },

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sessionIcon: { ...type.body, color: colors.textMuted },
  sessionText: { ...type.body, color: colors.text, flex: 1 },
  sessionXp: { ...type.label, color: colors.success, fontVariant: ['tabular-nums'] },

  celebrationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  celebrationGlyph: { fontSize: 22 },
  celebrationText: { ...type.heading, color: colors.accentBright, flex: 1 },

  duelRow: { flexDirection: 'row' },
  duelLabel: {
    ...type.caption,
    color: colors.warning,
    letterSpacing: 1,
  },

  menu: {
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  menuItem: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  menuItemText: { ...type.label, color: colors.text },
  menuItemDanger: { color: colors.danger },
  menuItemMuted: { color: colors.textFaint },
  menuDivider: { height: 1, backgroundColor: colors.border },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  footerAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footerIcon: { fontSize: 16, color: colors.textMuted },
  footerIconLiked: { color: colors.danger },
  footerCount: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  footerCountLiked: { color: colors.danger },
});
