/**
 * The book as the client sees it: the row plus its progress as an enemy.
 *
 * One shape for every route that returns a book, so the books list, the "today"
 * summary and a log's response cannot drift apart.
 */

import { bookProgress, type BookProgress } from '@habitwar/domain';
import type { Book, BookStatus } from '@prisma/client';

export interface BookView {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
  readonly pagesRead: number;
  readonly status: BookStatus;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly progress: BookProgress;
}

export function toBookView(book: Book): BookView {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    pageCount: book.pageCount,
    pagesRead: book.pagesRead,
    status: book.status,
    finishedAt: book.finishedAt,
    createdAt: book.createdAt,
    progress: bookProgress(book.pagesRead, book.pageCount),
  };
}
