/**
 * One feed post.
 *
 * The card's job is to make post *kind* legible at a glance, because the feed mixes
 * machine-generated and human posts and they carry very different weight:
 *
 *  - `DAILY_DIGEST` is the spec's anti-spam default (§5.1): a whole day rolled into
 *    one row — "Selimcan bugün 3 seans, 145 XP". It renders as a stat strip on a
 *    light recessed fill, with the numbers at display size, since the numbers *are*
 *    the content.
 *  - `SESSION_COMPLETE` is a single session the user chose to share — "30 dk okudu,
 *    +42 XP". It renders as one inline line with no fill behind it, deliberately
 *    quieter than a digest so a shared session never out-shouts a day's work.
 *  - `LEVEL_UP` and `ACHIEVEMENT` are celebrations: a tinted icon leads the row. The
 *    card itself stays a card — the icon and the words say "celebration" without the
 *    whole surface changing colour.
 *  - Everything else is plain text, which is what an unknown future type degrades to.
 *
 * Moderation is not optional here. App Store guideline 1.2 requires a report and a
 * block path on any user-generated content feed, so every single card exposes both —
 * via the overflow button and via long-press, since users reach for either.
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
import { categoryLabels, colors, radius, spacing, type } from '../theme';
import { Button, cardStyle } from './Button';
import { Icon } from './Icon';

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

/** Footer and overflow icons. Large enough to hit, small enough to stay chrome. */
const ICON_SIZE = 20;

/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const LONG_PRESS_MS = 400;
/** Icons that sit inside a disc or beside caption text. */
const ICON_SIZE_SMALL = 18;
const ICON_SIZE_DISC = 22;

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

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const initial = (post.author.displayName.trim()[0] ?? '?').toLocaleUpperCase('tr-TR');

  return (
    <Animated.View style={styles.card}>
      {/*
        The long-press target deliberately does NOT wrap the whole card.
        react-native-web renders every Pressable as a <button>, and HTML forbids a
        button inside a button — nesting the menu and like controls under a card-wide
        Pressable produced a hydration error on web and an ambiguous hit target
        everywhere. So the long-press covers exactly the inert regions: the author
        block and the post body. The menu and like buttons are siblings.
      */}
      <View style={styles.header}>
        {post.author.avatarUrl ? (
          <Image source={{ uri: post.author.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}

        <Pressable
          style={styles.headerText}
          onLongPress={toggleMenu}
          delayLongPress={LONG_PRESS_MS}
          accessibilityRole="button"
          accessibilityLabel={`${post.author.displayName} gönderisi. Seçenekler için uzun bas.`}
        >
          <Text style={styles.displayName} numberOfLines={1}>
            {post.author.displayName}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            Sv {post.author.level} · {formatRelativeTime(post.createdAt)}
          </Text>
        </Pressable>

        <Pressable
          onPress={toggleMenu}
          hitSlop={12}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel="Gönderi seçenekleri"
        >
          <Icon name="ellipsis" size={ICON_SIZE} color={colors.textMuted} />
        </Pressable>
      </View>

      <Pressable
        onLongPress={toggleMenu}
        delayLongPress={LONG_PRESS_MS}
        accessibilityRole="button"
        accessibilityLabel="Gönderi içeriği. Seçenekler için uzun bas."
      >
        <PostBody post={post} />
      </Pressable>

      {menuOpen && (
        // Stacked full-width buttons rather than bordered rows: the app has one
        // pressable vocabulary, and a moderation menu is not special enough to invent
        // a second. Full width because the block action names the account it blocks,
        // which does not fit on a chip.
        <View style={styles.menu}>
          <Button
            label="Şikayet et"
            tone="neutral"
            size="small"
            onPress={openReportSheet}
            accessibilityLabel="Gönderiyi şikayet et"
          />
          <Button
            label={`@${post.author.username} kullanıcısını engelle`}
            tone="danger"
            size="small"
            onPress={confirmBlock}
            accessibilityLabel={`${post.author.displayName} kullanıcısını engelle`}
          />
          <Button
            label="Vazgeç"
            tone="neutral"
            size="small"
            onPress={closeMenu}
            accessibilityLabel="Menüyü kapat"
          />
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
          {/*
            The scale animation moves the wrapper, not the glyph: an icon font cannot
            be scaled through `fontSize` on the UI thread the way a transform can.
          */}
          <Animated.View style={heartStyle}>
            <Icon
              name={post.likedByMe ? 'heart-filled' : 'heart'}
              size={ICON_SIZE}
              color={post.likedByMe ? colors.danger : colors.textMuted}
            />
          </Animated.View>
          <Text style={[styles.footerCount, post.likedByMe && styles.footerCountLiked]}>
            {post.likeCount}
          </Text>
        </Pressable>

        <View
          style={styles.footerAction}
          accessibilityRole="text"
          accessibilityLabel={`${post.replyCount} yorum`}
        >
          <Icon name="comment" size={ICON_SIZE} color={colors.textMuted} />
          <Text style={styles.footerCount}>{post.replyCount}</Text>
        </View>
      </View>
    </Animated.View>
  );
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
      // One session, one line. The digest above is the loud format; this stays small,
      // which is why there is no fill and no disc behind the icon here.
      const parts: string[] = [];
      if (session?.durationMinutes !== undefined) parts.push(`${session.durationMinutes} dk`);
      if (session?.habitName) parts.push(session.habitName);
      const summary = parts.length > 0 ? parts.join(' ') : 'Bir seans tamamlandı';

      return (
        <View style={styles.body}>
          <View style={styles.sessionRow}>
            <Icon name="clock" size={ICON_SIZE_SMALL} color={colors.textMuted} />
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
            <View style={[styles.celebrationDisc, styles.celebrationDiscLevel]}>
              <Icon name="xp-bolt-filled" size={ICON_SIZE_DISC} color={colors.xp} />
            </View>
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
            <View style={[styles.celebrationDisc, styles.celebrationDiscBadge]}>
              <Icon name="medal" size={ICON_SIZE_DISC} color={colors.goldDark} />
            </View>
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
            <Icon name="flame-filled" size={ICON_SIZE_SMALL} color={colors.fire} />
            <Text style={styles.duelLabel}>Düello sonucu</Text>
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

/** Falls through to the raw value so an enum added server-side still renders. */
function categoryLabel(category: string): string {
  return categoryLabels[category] ?? category;
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

const AVATAR = 44;
const DISC = 40;

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.sm },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  /** Neutral, like a contact without a photo: an avatar is not a control, so not violet. */
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSunken,
  },
  avatarInitial: { ...type.heading, color: colors.textMuted },
  headerText: { flex: 1, gap: 2 },
  displayName: { ...type.heading, color: colors.text },
  meta: { ...type.caption, color: colors.textFaint },
  menuButton: { paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },

  body: { gap: spacing.sm },
  content: { ...type.body, color: colors.text, lineHeight: 21 },
  media: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },

  digestHeadline: { ...type.heading, color: colors.text },
  digestFootnote: { ...type.caption, color: colors.textMuted },
  /** A light recessed band: the day's totals read as a readout without a dark slab. */
  statStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  statChip: { flex: 1, alignItems: 'center', gap: 2 },
  /** Display size: on a digest the number is the post. */
  statChipValue: { ...type.display, color: colors.text },
  statChipValueHighlight: { color: colors.successDark },
  statChipLabel: { ...type.caption, color: colors.textMuted },

  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sessionText: { ...type.body, color: colors.text, flex: 1 },
  sessionXp: { ...type.label, color: colors.successDark, fontVariant: ['tabular-nums'] },

  celebrationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  celebrationDisc: {
    width: DISC,
    height: DISC,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrationDiscLevel: { backgroundColor: colors.xpSoft },
  /** Warmth for a badge, so the two celebrations are not the same card twice. */
  celebrationDiscBadge: { backgroundColor: colors.goldSoft },
  celebrationText: { ...type.heading, color: colors.text, flex: 1 },

  duelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  duelLabel: { ...type.label, color: colors.fireDark },

  /** A tinted tray, so the open menu reads as attached to this card and not the list. */
  menu: {
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.sm,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  footerAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footerCount: { ...type.label, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  footerCountLiked: { color: colors.danger },
});
