/**
 * A book as the enemy it is in the game: its unread pages are its health.
 *
 * The bar drains as the reader logs pages, which is the whole visual promise of the
 * app — the fight is the book itself, so the bar can never show anything but real
 * progress.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '../api/reading';
import { formatDate, useLanguage, useT } from '../i18n';
import { colors, radius, spacing, type } from '../theme';
import { cardStyle } from './Button';
import { Icon } from './Icon';

export interface BookCardProps {
  readonly book: Book;
  /** Shown on a book still being read. */
  readonly onLog?: () => void;
  /** Opens the edit sheet. */
  readonly onEdit?: () => void;
}

export function BookCard({ book, onLog, onEdit }: BookCardProps): React.JSX.Element {
  const t = useT();
  const lang = useLanguage((state) => state.lang);
  const { progress } = book;
  const hpRatio = 1 - progress.ratio;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onEdit}
        disabled={!onEdit}
        style={styles.header}
        accessibilityRole={onEdit ? 'button' : undefined}
      >
        <View style={[styles.emblem, progress.defeated && styles.emblemDefeated]}>
          <Icon
            name={progress.defeated ? 'trophy' : 'shelf'}
            size={22}
            color={progress.defeated ? colors.goldDark : colors.accent}
          />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={2}>
            {book.title}
          </Text>
          {book.author ? (
            <Text style={styles.author} numberOfLines={1}>
              {book.author}
            </Text>
          ) : null}
        </View>
        {onEdit ? <Icon name="edit" size={18} color={colors.textFaint} /> : null}
      </Pressable>

      {progress.defeated ? (
        <Text style={styles.finished}>
          {book.finishedAt ? t.book.finishedOn(formatDate(book.finishedAt, lang)) : t.book.defeated}
        </Text>
      ) : (
        <>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: progress.maxHp, now: progress.hp }}
          >
            <View style={[styles.fill, { width: `${Math.max(hpRatio * 100, 2)}%` }]} />
          </View>
          <View style={styles.meta}>
            <Text style={styles.hp}>{t.book.hpLeft(progress.hp)}</Text>
            <Text style={styles.count}>{t.book.progress(book.pagesRead, book.pageCount)}</Text>
          </View>
          {onLog ? (
            <Pressable
              onPress={onLog}
              style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Icon name="plus" size={18} color={colors.textOnAccent} />
              <Text style={styles.logLabel}>{t.book.logPages}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.sm + 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emblem: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemDefeated: { backgroundColor: colors.goldSoft },
  titles: { flex: 1 },
  title: { ...type.heading, color: colors.text },
  author: { ...type.caption, color: colors.textMuted },
  track: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
  hp: { ...type.label, color: colors.dangerDark },
  count: { ...type.caption, color: colors.textFaint, fontVariant: ['tabular-nums'] },
  finished: { ...type.caption, color: colors.goldDark },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  logLabel: { ...type.label, color: colors.textOnAccent },
  pressed: { opacity: 0.7 },
});
