/**
 * Adding a book, or correcting one: title, author, page count.
 *
 * A new book starts with search: the reader types a title and picks a result, which
 * fills in the author, the page count and the cover. When search finds nothing, or
 * the reader wants something else, the fields below stay editable by hand. Editing
 * also offers deletion, behind a confirmation.
 */

import { MAX_BOOK_PAGES } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import {
  createBook,
  deleteBook,
  searchBooks,
  updateBook,
  type Book,
  type BookInput,
  type BookSearchResult,
} from '../api/reading';
import { confirmDestructive } from '../confirm';
import { useT } from '../i18n';
import { colors, radius, spacing, type } from '../theme';
import { BookCover } from './BookCover';
import { Button } from './Button';
import { FormField } from './FormField';
import { Sheet } from './Sheet';

/** Wait for a pause in typing before searching, so each keystroke is not a request. */
const SEARCH_DEBOUNCE_MS = 400;
const SEARCH_MIN_LENGTH = 2;

export interface BookFormSheetProps {
  readonly visible: boolean;
  /** The book being edited; null adds a new one. */
  readonly book: Book | null;
  readonly onClose: () => void;
  /** Called after the book is deleted, so a screen showing it can leave. */
  readonly onDeleted?: () => void;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function BookFormSheet({ visible, book, onClose, onDeleted }: BookFormSheetProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [titleError, setTitleError] = useState('');
  const [pagesError, setPagesError] = useState('');
  const [generalError, setGeneralError] = useState('');

  const isNew = book === null;
  const debouncedQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useQuery({
    queryKey: ['book-search', debouncedQuery],
    queryFn: ({ signal }) => searchBooks(debouncedQuery, signal),
    enabled: visible && isNew && debouncedQuery.length >= SEARCH_MIN_LENGTH,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setTitle(book?.title ?? '');
    setAuthor(book?.author ?? '');
    setPages(book ? String(book.pageCount) : '');
    setCoverUrl(book?.coverUrl ?? null);
    setTitleError('');
    setPagesError('');
    setGeneralError('');
  }, [visible, book]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['books'] });
    void queryClient.invalidateQueries({ queryKey: ['book'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  };

  const save = useMutation({
    mutationFn: (input: BookInput) => (book ? updateBook(book.id, input) : createBook(input)),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.code === 'UNPROCESSABLE') {
        setPagesError(t.bookForm.pagesBelowRead);
      } else if (failure instanceof ApiError && failure.code === 'NETWORK') {
        setGeneralError(t.common.networkError);
      } else {
        setGeneralError(t.common.genericError);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBook(id),
    onSuccess: () => {
      refresh();
      onClose();
      onDeleted?.();
    },
    onError: () => setGeneralError(t.common.genericError),
  });

  function pick(result: BookSearchResult): void {
    setTitle(result.title);
    setAuthor(result.author ?? '');
    setPages(result.pageCount ? String(result.pageCount) : '');
    setCoverUrl(result.coverUrl);
    setQuery('');
    setTitleError('');
    setPagesError('');
  }

  function submit(): void {
    const pageCount = Number.parseInt(pages, 10);
    let ok = true;
    if (title.trim() === '') {
      setTitleError(t.bookForm.titleRequired);
      ok = false;
    }
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_BOOK_PAGES) {
      setPagesError(t.bookForm.pagesInvalid(MAX_BOOK_PAGES));
      ok = false;
    }
    if (!ok) return;
    save.mutate({ title: title.trim(), author: author.trim() || null, pageCount, coverUrl });
  }

  function confirmDelete(): void {
    if (!book) return;
    confirmDestructive({
      title: t.bookForm.deleteTitle,
      message: t.bookForm.deleteBody,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      onConfirm: () => remove.mutate(book.id),
    });
  }

  const searching = query.trim().length >= SEARCH_MIN_LENGTH;
  const results = search.data ?? [];

  return (
    <Sheet visible={visible} title={book ? t.bookForm.editTitle : t.bookForm.newTitle} onClose={onClose}>
      {isNew ? (
        <>
          <FormField
            label={t.search.label}
            placeholder={t.search.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {searching && (search.isFetching || query.trim() !== debouncedQuery) ? (
            <View style={styles.status}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={styles.statusText}>{t.search.searching}</Text>
            </View>
          ) : searching && results.length === 0 ? (
            <Text style={styles.statusText}>{t.search.noResults}</Text>
          ) : searching ? (
            <View style={styles.results}>
              {results.slice(0, 6).map((result, index) => (
                <Pressable
                  key={`${result.title}-${index}`}
                  onPress={() => pick(result)}
                  style={({ pressed }) => [styles.result, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={result.title}
                >
                  <BookCover uri={result.coverUrl} width={36} />
                  <View style={styles.resultText}>
                    <Text style={styles.resultTitle} numberOfLines={2}>
                      {result.title}
                    </Text>
                    <Text style={styles.resultMeta} numberOfLines={1}>
                      {[result.author, result.pageCount ? t.common.pages(result.pageCount) : t.search.pagesUnknown]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {coverUrl ? (
        <View style={styles.coverRow}>
          <BookCover uri={coverUrl} width={56} />
        </View>
      ) : null}

      <FormField
        label={t.bookForm.titleLabel}
        value={title}
        onChangeText={(value) => {
          setTitle(value);
          setTitleError('');
        }}
        error={titleError}
        maxLength={200}
        autoCorrect
      />
      <FormField
        label={t.bookForm.authorLabel}
        value={author}
        onChangeText={setAuthor}
        maxLength={200}
        autoCorrect
      />
      <FormField
        label={t.bookForm.pagesLabel}
        value={pages}
        onChangeText={(value) => {
          setPages(value.replace(/[^0-9]/g, ''));
          setPagesError('');
        }}
        error={pagesError || generalError}
        keyboardType="number-pad"
        maxLength={4}
      />
      <Button label={t.common.save} onPress={submit} loading={save.isPending} />
      {book ? (
        <Button label={t.common.delete} tone="neutral" onPress={confirmDelete} loading={remove.isPending} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { ...type.caption, color: colors.textMuted },
  results: { borderRadius: radius.md, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  resultText: { flex: 1 },
  resultTitle: { ...type.label, color: colors.text },
  resultMeta: { ...type.caption, color: colors.textMuted },
  coverRow: { alignItems: 'flex-start' },
  pressed: { opacity: 0.6 },
});
