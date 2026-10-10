/**
 * "How many pages did you read?" — the ten-second action the whole app exists for.
 *
 * Quick picks cover the common answers in one tap; the field takes anything else.
 * The idempotency key is made once per opening of the sheet, so a retry after a
 * timeout cannot log the same reading twice.
 */

import { MAX_PAGES_PER_LOG } from '@habitwar/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ApiError } from '../api/client';
import { PROFILE_KEY } from '../api/me';
import { logPages, newRequestId, type Book, type LogResult } from '../api/reading';
import { useT } from '../i18n';
import { colors, type } from '../theme';
import { Button } from './Button';
import { FormField } from './FormField';
import { OptionPills } from './OptionPills';
import { Sheet } from './Sheet';

const QUICK_PICKS: readonly number[] = [5, 10, 20, 30];

export interface LogPagesSheetProps {
  readonly book: Book | null;
  readonly onClose: () => void;
  readonly onLogged: (result: LogResult) => void;
}

export function LogPagesSheet({ book, onClose, onLogged }: LogPagesSheetProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);

  // A fresh form, and a fresh idempotency key, every time the sheet opens on a book.
  useEffect(() => {
    if (book) {
      setText('');
      setError('');
      setRequestId(newRequestId());
    }
  }, [book]);

  const mutation = useMutation({
    mutationFn: ({ bookId, pages }: { bookId: string; pages: number }) =>
      logPages(bookId, pages, requestId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
      onLogged(result);
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.code === 'CONFLICT') setError(t.log.finishedConflict);
      else if (failure instanceof ApiError && failure.code === 'NETWORK') setError(t.common.networkError);
      else setError(t.common.genericError);
    },
  });

  const pages = Number.parseInt(text, 10);
  const valid = Number.isInteger(pages) && pages >= 1 && pages <= MAX_PAGES_PER_LOG;

  function submit(): void {
    if (!book) return;
    if (!valid) {
      setError(t.log.invalid);
      return;
    }
    mutation.mutate({ bookId: book.id, pages });
  }

  return (
    <Sheet visible={book !== null} title={t.log.title} onClose={onClose}>
      {book ? <Text style={styles.book}>{book.title}</Text> : null}
      <OptionPills
        options={QUICK_PICKS}
        value={valid && QUICK_PICKS.includes(pages) ? pages : -1}
        onChange={(option) => {
          setText(String(option));
          setError('');
        }}
        format={(option) => String(option)}
        describe={(option) => t.common.pages(option)}
      />
      <FormField
        label={t.log.pagesLabel}
        value={text}
        onChangeText={(value) => {
          setText(value.replace(/[^0-9]/g, ''));
          setError('');
        }}
        error={error}
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={submit}
        maxLength={4}
      />
      <Button label={t.log.save} onPress={submit} loading={mutation.isPending} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  book: { ...type.heading, color: colors.textMuted },
});
