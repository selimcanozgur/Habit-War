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
  readonly coverUrl: string | null;
  readonly pageCount: number;
  readonly pagesRead: number;
  readonly status: BookStatus;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly rating: number | null;
  readonly review: string | null;
  readonly takeaways: readonly string[];
  readonly progress: BookProgress;
}

/** When the reader will finish, at their recent pace. */
export interface BookForecast {
  /** Null when there is no recent reading to project from. */
  readonly daysToFinish: number | null;
  /** Pages a day that would finish the book by the end of this month. */
  readonly pagesPerDayForMonthEnd: number;
  readonly daysLeftInMonth: number;
}

export function toBookView(book: Book): BookView {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    pageCount: book.pageCount,
    pagesRead: book.pagesRead,
    status: book.status,
    finishedAt: book.finishedAt,
    createdAt: book.createdAt,
    rating: book.rating,
    review: book.review,
    takeaways: book.takeaways,
    progress: bookProgress(book.pagesRead, book.pageCount),
  };
}
