/**
 * The book features through `app.inject()`: search, the book detail (victory card),
 * notes, phases, forecasts, the reading calendar, the verdict fields and the yearly
 * goal. Book search runs against a stub, never the real provider.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { searchBooks, type FetchLike } from '../lib/book-search.js';
import { buildServer } from '../server.js';

const prisma = new PrismaClient();
const PREFIX = 'test_feat_';

let app: FastifyInstance;
let userId: string;
let searchCalls: string[] = [];

beforeAll(async () => {
  app = await buildServer(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      LOG_LEVEL: 'fatal',
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv),
    {
      bookSearch: async (query) => {
        searchCalls.push(query);
        if (query === 'boom') throw new Error('provider down');
        return [{ title: 'Simyacı', author: 'Paulo Coelho', pageCount: 188, coverUrl: 'https://example.com/c.jpg' }];
      },
    },
  );
});

beforeEach(async () => {
  searchCalls = [];
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}reader`,
      displayName: 'Okur',
      email: `${PREFIX}reader@example.com`,
      timezone: 'Europe/Istanbul',
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await app.close();
  await prisma.$disconnect();
});

function request(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { 'x-dev-user-id': userId },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function addBook(pageCount = 100, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request('POST', '/v1/books', { title: 'Kitap', pageCount, ...extra });
  expect(response.statusCode).toBe(201);
  return response.json().book.id as string;
}

function log(bookId: string, pages: number, note?: string) {
  return request('POST', `/v1/books/${bookId}/logs`, {
    pages,
    clientRequestId: randomUUID(),
    ...(note !== undefined ? { note } : {}),
  });
}

describe('book search', () => {
  it('returns the provider results', async () => {
    const response = await request('GET', '/v1/books/search?q=simyaci');
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0]).toMatchObject({ title: 'Simyacı', pageCount: 188 });
    expect(searchCalls).toEqual(['simyaci']);
  });

  it('answers a provider outage with no results, not an error', async () => {
    const response = await request('GET', '/v1/books/search?q=boom');
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([]);
  });

  it('needs at least two characters', async () => {
    expect((await request('GET', '/v1/books/search?q=a')).statusCode).toBe(400);
  });

  it('keeps the cover a search found', async () => {
    const id = await addBook(100, { coverUrl: 'https://example.com/c.jpg' });
    const book = await prisma.book.findUniqueOrThrow({ where: { id } });
    expect(book.coverUrl).toBe('https://example.com/c.jpg');
  });

  it('refuses a cover that is not https', async () => {
    const response = await request('POST', '/v1/books', {
      title: 'Kitap',
      pageCount: 10,
      coverUrl: 'http://example.com/c.jpg',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('searchBooks (providers)', () => {
  /** Answers per provider host; anything not listed fails like an outage. */
  function fakeFetch(answers: { google?: unknown; openLibrary?: unknown }): FetchLike {
    return async (url) => {
      const body = url.includes('googleapis') ? answers.google : answers.openLibrary;
      return body === undefined ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => body };
    };
  }

  const volume = {
    volumeInfo: {
      title: 'Simyacı',
      authors: ['Paulo Coelho'],
      pageCount: 188,
      imageLinks: { thumbnail: 'http://books.google.com/x.jpg' },
    },
  };

  it('maps Google volumes, upgrades covers to https and drops duplicate editions', async () => {
    const results = await searchBooks('simyaci', {
      fetchFn: fakeFetch({ google: { items: [volume, volume, { volumeInfo: {} }] } }),
    });
    expect(results).toEqual([
      { title: 'Simyacı', author: 'Paulo Coelho', pageCount: 188, coverUrl: 'https://books.google.com/x.jpg' },
    ]);
  });

  it('falls back to Open Library when Google is down', async () => {
    const results = await searchBooks('simyaci', {
      fetchFn: fakeFetch({
        openLibrary: { docs: [{ title: 'Simyacı', author_name: ['Paulo Coelho'], number_of_pages_median: 184, cover_i: 42 }] },
      }),
    });
    expect(results).toEqual([
      { title: 'Simyacı', author: 'Paulo Coelho', pageCount: 184, coverUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg' },
    ]);
  });

  it('falls back to Open Library when Google finds nothing', async () => {
    const results = await searchBooks('x', {
      fetchFn: fakeFetch({ google: { items: [] }, openLibrary: { docs: [{ title: 'Kitap' }] } }),
    });
    expect(results[0]).toMatchObject({ title: 'Kitap', pageCount: null, author: null, coverUrl: null });
  });

  it('throws when every provider fails, for the route to absorb', async () => {
    await expect(searchBooks('x', { fetchFn: fakeFetch({}) })).rejects.toThrow();
  });

  it('returns nothing, without throwing, when every provider answers empty', async () => {
    const results = await searchBooks('x', { fetchFn: fakeFetch({ google: {}, openLibrary: { docs: [] } }) });
    expect(results).toEqual([]);
  });
});

describe('notes and the book detail', () => {
  it('stores a note and shows it on the book, oldest first', async () => {
    const id = await addBook();
    await log(id, 10, 'İlk bölüm çok güzeldi');
    await log(id, 5, '   ');
    await log(id, 5, 'İkinci not');

    const response = await request('GET', `/v1/books/${id}`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.notes.map((note: { note: string }) => note.note)).toEqual(['İlk bölüm çok güzeldi', 'İkinci not']);
    expect(body.stats).toMatchObject({ daysRead: 1, daysSpent: 1, pagesPerDay: 20 });
    expect(body.forecast).toMatchObject({ daysToFinish: 4 });
  });

  it('has no forecast for a finished book', async () => {
    const id = await addBook(20);
    await log(id, 20);
    const body = (await request('GET', `/v1/books/${id}`)).json();
    expect(body.book.status).toBe('FINISHED');
    expect(body.forecast).toBeNull();
  });

  it("refuses someone else's book", async () => {
    const other = await prisma.user.create({
      data: { username: `${PREFIX}other`, displayName: 'B', email: `${PREFIX}other@example.com` },
    });
    const theirs = await prisma.book.create({ data: { userId: other.id, title: 'X', pageCount: 10 } });
    expect((await request('GET', `/v1/books/${theirs.id}`)).statusCode).toBe(404);
  });
});

describe('phases', () => {
  it('reports the quarter a log crosses', async () => {
    const id = await addBook(100);
    expect((await log(id, 20)).json().phase).toBeNull();
    expect((await log(id, 10)).json().phase).toBe(0.25);
    expect((await log(id, 30)).json().phase).toBe(0.5);
  });
});

describe('forecast on today', () => {
  it('attaches a finish estimate to each current book', async () => {
    const id = await addBook(100);
    await log(id, 10);
    const body = (await request('GET', '/v1/today')).json();
    expect(body.books[0].forecast).toMatchObject({ daysToFinish: 9 });
    expect(body.books[0].forecast.pagesPerDayForMonthEnd).toBeGreaterThan(0);
  });

  it('has no estimate for a book never read', async () => {
    await addBook(100);
    const body = (await request('GET', '/v1/today')).json();
    expect(body.books[0].forecast.daysToFinish).toBeNull();
  });
});

describe('verdict', () => {
  it('saves a rating, a review and up to three takeaways', async () => {
    const id = await addBook(10);
    await log(id, 10);
    const response = await request('PATCH', `/v1/books/${id}`, {
      rating: 5,
      review: 'Hayatımı değiştirdi',
      takeaways: ['Bir', 'İki', 'Üç'],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().book).toMatchObject({ rating: 5, review: 'Hayatımı değiştirdi', takeaways: ['Bir', 'İki', 'Üç'] });
  });

  it('refuses a fourth takeaway and a sixth star', async () => {
    const id = await addBook(10);
    expect((await request('PATCH', `/v1/books/${id}`, { takeaways: ['1', '2', '3', '4'] })).statusCode).toBe(400);
    expect((await request('PATCH', `/v1/books/${id}`, { rating: 6 })).statusCode).toBe(400);
  });
});

describe('calendar', () => {
  it('returns pages per day in the window, oldest first', async () => {
    const id = await addBook(100);
    await log(id, 7);
    await log(id, 3);
    const body = (await request('GET', '/v1/calendar?days=30')).json();
    expect(body.days).toHaveLength(1);
    expect(body.days[0].pages).toBe(10);
    expect(body).toHaveProperty('from');
    expect(body).toHaveProperty('dailyGoal');
  });
});

describe('yearly goal', () => {
  it('counts books finished this year against the goal', async () => {
    expect((await request('PATCH', '/v1/me', { yearlyBookGoal: 12 })).statusCode).toBe(200);
    const id = await addBook(10);
    await log(id, 10);

    const { profile } = (await request('GET', '/v1/me')).json();
    expect(profile.yearly).toMatchObject({ goal: 12, finished: 1 });
    expect(profile.yearly.year).toBeGreaterThan(2000);
  });

  it('turns off with null', async () => {
    await request('PATCH', '/v1/me', { yearlyBookGoal: 12 });
    const { profile } = (await request('PATCH', '/v1/me', { yearlyBookGoal: null })).json();
    expect(profile.yearly.goal).toBeNull();
  });
});
