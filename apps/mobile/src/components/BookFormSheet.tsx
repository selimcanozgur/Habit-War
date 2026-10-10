/**
 * Adding a book, or correcting one: title, author, page count. Editing also offers
 * deletion, behind a confirmation.
 */

import { MAX_BOOK_PAGES } from '@habitwar/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import { createBook, deleteBook, updateBook, type Book, type BookInput } from '../api/reading';
import { confirmDestructive } from '../confirm';
import { useT } from '../i18n';
import { Button } from './Button';
import { FormField } from './FormField';
import { Sheet } from './Sheet';

export interface BookFormSheetProps {
  readonly visible: boolean;
  /** The book being edited; null adds a new one. */
  readonly book: Book | null;
  readonly onClose: () => void;
}

export function BookFormSheet({ visible, book, onClose }: BookFormSheetProps): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [titleError, setTitleError] = useState('');
  const [pagesError, setPagesError] = useState('');
  const [generalError, setGeneralError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTitle(book?.title ?? '');
    setAuthor(book?.author ?? '');
    setPages(book ? String(book.pageCount) : '');
    setTitleError('');
    setPagesError('');
    setGeneralError('');
  }, [visible, book]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['books'] });
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
    },
    onError: () => setGeneralError(t.common.genericError),
  });

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
    save.mutate({ title: title.trim(), author: author.trim() || null, pageCount });
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

  return (
    <Sheet
      visible={visible}
      title={book ? t.bookForm.editTitle : t.bookForm.newTitle}
      onClose={onClose}
    >
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
        <Button
          label={t.common.delete}
          tone="neutral"
          onPress={confirmDelete}
          loading={remove.isPending}
        />
      ) : null}
    </Sheet>
  );
}
