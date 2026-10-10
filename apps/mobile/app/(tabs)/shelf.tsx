/**
 * Raf — every book: the ones being fought, and the defeated ones as trophies.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getBooks, type Book } from '../../src/api/reading';
import { BookCard } from '../../src/components/BookCard';
import { BookFormSheet } from '../../src/components/BookFormSheet';
import { Button, cardStyle } from '../../src/components/Button';
import { ScreenHero } from '../../src/components/ScreenHero';
import { useT } from '../../src/i18n';
import { colors, spacing, type } from '../../src/theme';

export default function ShelfScreen(): React.JSX.Element {
  const t = useT();
  const booksQuery = useQuery({ queryKey: ['books'], queryFn: getBooks });
  const [editing, setEditing] = useState<Book | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const books = booksQuery.data ?? [];
  const reading = books.filter((book) => book.status === 'READING');
  const finished = books.filter((book) => book.status === 'FINISHED');

  function open(book: Book | null): void {
    setEditing(book);
    setFormOpen(true);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={booksQuery.isRefetching}
            onRefresh={() => void booksQuery.refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <ScreenHero image="battle" title={t.shelf.title} subtitle={t.shelf.subtitle} />

        <View style={styles.body}>
          {booksQuery.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : booksQuery.isError ? (
            <View style={styles.card}>
              <Text style={styles.muted}>{t.common.loadError}</Text>
              <Button label={t.common.retry} tone="neutral" onPress={() => void booksQuery.refetch()} />
            </View>
          ) : (
            <>
              <Button label={t.today.addBook} onPress={() => open(null)} />

              {reading.length > 0 ? <Text style={styles.overline}>{t.shelf.reading}</Text> : null}
              {reading.map((book) => (
                <BookCard key={book.id} book={book} onEdit={() => open(book)} />
              ))}

              <Text style={styles.overline}>{t.shelf.finished}</Text>
              {finished.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.muted}>{t.shelf.emptyFinished}</Text>
                </View>
              ) : (
                finished.map((book) => <BookCard key={book.id} book={book} onEdit={() => open(book)} />)
              )}
            </>
          )}
        </View>
      </ScrollView>

      <BookFormSheet visible={formOpen} book={editing} onClose={() => setFormOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  loader: { marginTop: spacing.xl },
  card: { ...cardStyle, gap: spacing.sm },
  muted: { ...type.body, color: colors.textMuted },
  overline: { ...type.overline, color: colors.textFaint, marginTop: spacing.sm },
});
