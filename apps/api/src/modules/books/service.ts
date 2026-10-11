/**
 * Books: the reader's shelf.
 *
 * Pages are never written here. `pagesRead` only moves through a reading log
 * (modules/reading), because a log is what pays XP and advances the streak; a book
 * edit that could also move pages would be a second, unscored way to progress.
 */

import type { BookStatus, PrismaClient } from '@prisma/client';

import { notFound, unprocessable } from '../../lib/errors.js';
import { definedOnly } from '../../lib/objects.js';

import type { CreateBookInput, UpdateBookInput } from './schemas.js';
import { toBookView, type BookView } from './view.js';

export interface BookServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
}

export class BookService {
  readonly #prisma: PrismaClient;
  readonly #now: () => Date;

  constructor(deps: BookServiceDeps) {
    this.#prisma = deps.prisma;
    this.#now = deps.now;
  }

  /** Books in reading order: current ones first by last activity, then finished ones. */
  async list(userId: string, status?: BookStatus): Promise<BookView[]> {
    const books = await this.#prisma.book.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return books.map(toBookView);
  }

  async create(userId: string, input: CreateBookInput): Promise<BookView> {
    const book = await this.#prisma.book.create({
      data: {
        userId,
        title: input.title,
        author: input.author ?? null,
        pageCount: input.pageCount,
        coverUrl: input.coverUrl ?? null,
      },
    });
    return toBookView(book);
  }

  /**
   * Edits a book's details.
   *
   * The page count may be corrected — editions differ — but never below the pages
   * already logged, which would leave a book read past its own end. Correcting it
   * down to exactly the pages read finishes the book, without the finishing bonus:
   * that bonus belongs to the log that reads the last page.
   */
  async update(userId: string, bookId: string, input: UpdateBookInput): Promise<BookView> {
    const book = await this.#owned(userId, bookId);

    const pageCount = input.pageCount ?? book.pageCount;
    if (pageCount < book.pagesRead) {
      throw unprocessable('Page count cannot be lower than the pages already read', {
        pagesRead: book.pagesRead,
      });
    }
    const finishesNow = book.status === 'READING' && pageCount === book.pagesRead;

    const updated = await this.#prisma.book.update({
      where: { id: book.id },
      data: {
        ...definedOnly({ title: input.title, pageCount: input.pageCount, takeaways: input.takeaways }),
        // Nullable fields: undefined leaves them alone, null clears them.
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.review !== undefined ? { review: input.review || null } : {}),
        ...(finishesNow ? { status: 'FINISHED' as const, finishedAt: this.#now() } : {}),
      },
    });
    return toBookView(updated);
  }

  /**
   * Removes a book and its logs. XP already earned stays: the ledger keeps its rows
   * (the link to the log is nulled), so the reader's level does not drop.
   */
  async remove(userId: string, bookId: string): Promise<void> {
    const book = await this.#owned(userId, bookId);
    await this.#prisma.book.delete({ where: { id: book.id } });
  }

  async #owned(userId: string, bookId: string) {
    const book = await this.#prisma.book.findFirst({ where: { id: bookId, userId } });
    if (!book) throw notFound('Book not found');
    return book;
  }
}
