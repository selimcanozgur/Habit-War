/**
 * Books, page logs and the "today" summary.
 *
 * The shapes mirror the API exactly; apps/api/src/__tests__/reading-api.test.ts
 * asserts the same keys from the server side, so a rename fails a test there rather
 * than blanking a screen here.
 */

import type { BookProgress, LevelProgress, ReadingLogScore } from '@habitwar/domain';

import { apiRequest } from './client';

export type BookStatus = 'READING' | 'FINISHED';

export interface Book {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
  readonly pagesRead: number;
  readonly status: BookStatus;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly progress: BookProgress;
}

export interface Today {
  readonly date: string;
  readonly dailyGoal: number;
  readonly pagesToday: number;
  readonly goalMet: boolean;
  readonly streak: { readonly current: number; readonly longest: number };
  readonly daysRead: number;
  readonly windowDays: number;
  readonly suggestedGoal: number | null;
  readonly books: readonly Book[];
}

export interface LogResult {
  readonly logId: string;
  readonly pages: number;
  readonly score: ReadingLogScore;
  readonly book: Book;
  readonly level: {
    readonly leveledUp: boolean;
    readonly fromLevel: number;
    readonly toLevel: number;
    readonly progress: LevelProgress;
  };
  readonly streak: { readonly current: number; readonly longest: number };
  readonly replayed: boolean;
}

export interface BookInput {
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
}

export function getToday(): Promise<Today> {
  return apiRequest<Today>('/v1/today');
}

export async function getBooks(): Promise<readonly Book[]> {
  return (await apiRequest<{ books: Book[] }>('/v1/books')).books;
}

export async function createBook(input: BookInput): Promise<Book> {
  return (await apiRequest<{ book: Book }>('/v1/books', { method: 'POST', body: input })).book;
}

export async function updateBook(id: string, input: Partial<BookInput>): Promise<Book> {
  return (await apiRequest<{ book: Book }>(`/v1/books/${id}`, { method: 'PATCH', body: input })).book;
}

export function deleteBook(id: string): Promise<void> {
  return apiRequest<void>(`/v1/books/${id}`, { method: 'DELETE' });
}

/**
 * Logs pages. `clientRequestId` must be generated once per user action and reused
 * on retry, so a request that timed out after the server saved it is not counted
 * twice.
 */
export function logPages(bookId: string, pages: number, clientRequestId: string): Promise<LogResult> {
  return apiRequest<LogResult>(`/v1/books/${bookId}/logs`, {
    method: 'POST',
    body: { pages, clientRequestId },
  });
}

/** A unique-enough id for idempotency keys. Not a security token. */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
