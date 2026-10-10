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
  readonly coverUrl: string | null;
  readonly pageCount: number;
  readonly pagesRead: number;
  readonly status: BookStatus;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly rating: number | null;
  readonly review: string | null;
  readonly takeaways: readonly string[];
  readonly progress: BookProgress;
}

export interface BookForecast {
  /** Null when there is no recent reading to project from. */
  readonly daysToFinish: number | null;
  readonly pagesPerDayForMonthEnd: number;
  readonly daysLeftInMonth: number;
}

export type BookWithForecast = Book & { readonly forecast: BookForecast };

export interface BookDetail {
  readonly book: Book;
  readonly stats: {
    readonly daysRead: number;
    readonly startedOn: string | null;
    readonly daysSpent: number;
    readonly pagesPerDay: number;
  };
  readonly notes: readonly { readonly date: string; readonly pages: number; readonly note: string }[];
  readonly forecast: BookForecast | null;
}

export interface BookSearchResult {
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number | null;
  readonly coverUrl: string | null;
}

export interface Calendar {
  readonly from: string;
  readonly to: string;
  readonly dailyGoal: number;
  readonly days: readonly { readonly date: string; readonly pages: number }[];
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
  readonly books: readonly BookWithForecast[];
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
  /** The quarter of the book this log crossed (0.25, 0.5, 0.75), or null. */
  readonly phase: number | null;
  readonly replayed: boolean;
}

export interface BookInput {
  readonly title: string;
  readonly author: string | null;
  readonly pageCount: number;
  readonly coverUrl?: string | null;
}

export interface BookVerdict {
  readonly rating?: number | null;
  readonly review?: string | null;
  readonly takeaways?: readonly string[];
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

export function getBook(id: string): Promise<BookDetail> {
  return apiRequest<BookDetail>(`/v1/books/${id}`);
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<readonly BookSearchResult[]> {
  const path = `/v1/books/search?q=${encodeURIComponent(query)}`;
  return (await apiRequest<{ results: BookSearchResult[] }>(path, signal ? { signal } : {})).results;
}

export function getCalendar(): Promise<Calendar> {
  return apiRequest<Calendar>('/v1/calendar');
}

export async function updateBook(id: string, input: Partial<BookInput> & BookVerdict): Promise<Book> {
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
export function logPages(
  bookId: string,
  pages: number,
  clientRequestId: string,
  note: string | null,
): Promise<LogResult> {
  return apiRequest<LogResult>(`/v1/books/${bookId}/logs`, {
    method: 'POST',
    body: { pages, clientRequestId, note },
  });
}

/** A unique-enough id for idempotency keys. Not a security token. */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
