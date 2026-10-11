/**
 * One book in full.
 *
 * A book still being read shows the fight: health, the finish estimate, the notes so
 * far. A finished book becomes its victory card: how long it took, the pace, the
 * reader's notes, and their verdict — stars, one line, three things to remember —
 * which they can share.
 */

import { MAX_TAKEAWAYS } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getBook, updateBook, type LogResult } from '../../../src/api/reading';
import { BookCover } from '../../../src/components/BookCover';
import { ForecastLine } from '../../../src/components/BookCard';
import { BookFormSheet } from '../../../src/components/BookFormSheet';
import { Button, cardStyle } from '../../../src/components/Button';
import { FormField } from '../../../src/components/FormField';
import { Icon } from '../../../src/components/Icon';
import { LogPagesSheet } from '../../../src/components/LogPagesSheet';
import { RewardSheet } from '../../../src/components/RewardSheet';
import { formatDate, useLanguage, useT } from '../../../src/i18n';
import { colors, radius, spacing, type } from '../../../src/theme';

export default function BookScreen(): React.JSX.Element {
  const t = useT();
  const lang = useLanguage((state) => state.lang);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detailQuery = useQuery({ queryKey: ['book', id], queryFn: () => getBook(id), enabled: Boolean(id) });

  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [reward, setReward] = useState<LogResult | null>(null);

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/shelf'));

  const detail = detailQuery.data;
  if (!detail) {
    return (
      <View style={styles.center}>
        {detailQuery.isError ? (
          <>
            <Text style={styles.muted}>{t.common.loadError}</Text>
            <Button label={t.common.back} tone="neutral" onPress={back} block={false} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  const { book, stats, notes, forecast } = detail;
  const finished = book.progress.defeated;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.topBar}>
          <Pressable onPress={back} hitSlop={spacing.sm} accessibilityRole="button" accessibilityLabel={t.common.back}>
            <Icon name="arrow-left" size={24} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setEditing(true)}
            hitSlop={spacing.sm}
            accessibilityRole="button"
            accessibilityLabel={t.detail.edit}
          >
            <Icon name="edit" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <BookCover uri={book.coverUrl} width={120} finished={finished} />
          <Text style={styles.title}>{book.title}</Text>
          {book.author ? <Text style={styles.author}>{book.author}</Text> : null}
          {finished && book.finishedAt ? (
            <Text style={styles.finishedOn}>{t.book.finishedOn(formatDate(book.finishedAt, lang))}</Text>
          ) : null}
        </View>

        <Text style={styles.overline}>{finished ? t.detail.victoryOverline : t.detail.progressOverline}</Text>
        <View style={styles.statsRow}>
          <Stat label={t.detail.daysSpent} value={t.detail.days(stats.daysSpent)} />
          <Stat label={t.detail.pagesPerDay} value={t.common.pages(stats.pagesPerDay)} />
          <Stat label={t.detail.daysRead} value={String(stats.daysRead)} />
        </View>

        {!finished ? (
          <View style={styles.card}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max((1 - book.progress.ratio) * 100, 2)}%` }]} />
            </View>
            <View style={styles.meta}>
              <Text style={styles.hp}>{t.book.hpLeft(book.progress.hp)}</Text>
              <Text style={styles.count}>{t.book.progress(book.pagesRead, book.pageCount)}</Text>
            </View>
            {forecast ? <ForecastLine forecast={forecast} /> : null}
            <Button label={t.book.logPages} onPress={() => setLogging(true)} />
          </View>
        ) : (
          <Verdict bookId={book.id} title={book.title} daysSpent={stats.daysSpent} initial={book} />
        )}

        <Text style={styles.overline}>{t.detail.notesOverline}</Text>
        <View style={styles.card}>
          {notes.length === 0 ? (
            <Text style={styles.muted}>{t.detail.noNotes}</Text>
          ) : (
            notes.map((note, index) => (
              <View key={`${note.date}-${index}`} style={[styles.note, index > 0 && styles.noteDivider]}>
                <Text style={styles.noteMeta}>
                  {formatDate(note.date, lang)} · {t.common.pages(note.pages)}
                </Text>
                <Text style={styles.noteText}>{note.note}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <BookFormSheet
        visible={editing}
        book={book}
        onClose={() => setEditing(false)}
        onDeleted={() => router.replace('/shelf')}
      />
      <LogPagesSheet
        book={logging ? book : null}
        onClose={() => setLogging(false)}
        onLogged={(result) => {
          setLogging(false);
          setReward(result);
        }}
      />
      <RewardSheet result={reward} onClose={() => setReward(null)} />
    </View>
  );
}

/** Stars, one line, three takeaways — and a way to share the card. */
function Verdict({
  bookId,
  title,
  daysSpent,
  initial,
}: {
  bookId: string;
  title: string;
  daysSpent: number;
  initial: { rating: number | null; review: string | null; takeaways: readonly string[] };
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState<number | null>(initial.rating);
  const [review, setReview] = useState(initial.review ?? '');
  const [takeaways, setTakeaways] = useState<string[]>(() =>
    Array.from({ length: MAX_TAKEAWAYS }, (_, index) => initial.takeaways[index] ?? ''),
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [rating, review, takeaways]);

  const save = useMutation({
    mutationFn: () =>
      updateBook(bookId, {
        rating,
        review: review.trim() || null,
        takeaways: takeaways.map((line) => line.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['book', bookId] });
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      setSaved(true);
    },
  });

  async function share(): Promise<void> {
    try {
      await Share.share({ message: t.detail.shareText(title, daysSpent, rating) });
    } catch {
      // Sharing is unavailable (e.g. a desktop browser without the Web Share API).
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{t.detail.rating}</Text>
      <View style={styles.stars} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            onPress={() => setRating(star === rating ? null : star)}
            hitSlop={4}
            accessibilityRole="radio"
            accessibilityState={{ selected: rating !== null && star <= rating }}
            accessibilityLabel={`${star}`}
          >
            <Icon
              name={rating !== null && star <= rating ? 'star-filled' : 'star'}
              size={30}
              color={rating !== null && star <= rating ? colors.gold : colors.borderStrong}
            />
          </Pressable>
        ))}
      </View>

      <FormField label={t.detail.review} value={review} onChangeText={setReview} maxLength={280} autoCorrect />

      <Text style={styles.label}>{t.detail.takeaways}</Text>
      {takeaways.map((line, index) => (
        <FormField
          key={index}
          label={`${index + 1}.`}
          value={line}
          onChangeText={(value) =>
            setTakeaways((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))
          }
          maxLength={200}
          autoCorrect
        />
      ))}

      <Button label={saved ? t.detail.saved : t.common.save} onPress={() => save.mutate()} loading={save.isPending} />
      <Button label={t.detail.share} tone="neutral" onPress={() => void share()} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={[styles.card, styles.stat]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hero: { alignItems: 'center', gap: spacing.xs },
  title: { ...type.title, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  author: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  finishedOn: { ...type.caption, color: colors.goldDark },
  overline: { ...type.overline, color: colors.textFaint, marginTop: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'flex-start' },
  statValue: { ...type.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { ...type.caption, color: colors.textMuted },
  card: { ...cardStyle, gap: spacing.sm },
  muted: { ...type.body, color: colors.textMuted },
  track: { height: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
  hp: { ...type.label, color: colors.dangerDark },
  count: { ...type.caption, color: colors.textFaint, fontVariant: ['tabular-nums'] },
  label: { ...type.heading, color: colors.text },
  stars: { flexDirection: 'row', gap: spacing.xs },
  note: { gap: 2, paddingVertical: spacing.xs },
  noteDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  noteMeta: { ...type.caption, color: colors.textFaint },
  noteText: { ...type.body, color: colors.text },
});
