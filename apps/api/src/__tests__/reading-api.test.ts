/**
 * The reading API end to end through `app.inject()`: shelf, logging, profile and
 * onboarding. Asserts the exact response keys the mobile client reads — the two
 * sides share no types, so a renamed key would otherwise surface as an empty screen.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

const prisma = new PrismaClient();
const PREFIX = 'test_api_';

let app: FastifyInstance;
let userId: string;

beforeAll(async () => {
  app = await buildServer(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      LOG_LEVEL: 'fatal',
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv),
  );
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  const user = await prisma.user.create({
    data: { username: `${PREFIX}reader`, displayName: 'Okur', email: `${PREFIX}reader@example.com` },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await app.close();
  await prisma.$disconnect();
});

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { 'x-dev-user-id': userId },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function addBook(pageCount = 200): Promise<string> {
  const response = await request('POST', '/v1/books', { title: 'Simyacı', author: 'Coelho', pageCount });
  expect(response.statusCode).toBe(201);
  return response.json().book.id as string;
}

describe('books', () => {
  it('adds a book and lists it with its progress', async () => {
    await addBook();
    const response = await request('GET', '/v1/books');

    expect(response.statusCode).toBe(200);
    const { books } = response.json();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      title: 'Simyacı',
      author: 'Coelho',
      pageCount: 200,
      pagesRead: 0,
      status: 'READING',
      progress: { maxHp: 200, hp: 200, ratio: 0, defeated: false },
    });
  });

  it('rejects a book without pages', async () => {
    const response = await request('POST', '/v1/books', { title: 'Boş', pageCount: 0 });
    expect(response.statusCode).toBe(400);
  });

  it('will not shrink the page count below the pages read', async () => {
    const id = await addBook();
    await request('POST', `/v1/books/${id}/logs`, { pages: 50, clientRequestId: randomUUID() });

    const response = await request('PATCH', `/v1/books/${id}`, { pageCount: 40 });
    expect(response.statusCode).toBe(422);
  });

  it('deletes a book but keeps the XP it earned', async () => {
    const id = await addBook();
    await request('POST', `/v1/books/${id}/logs`, { pages: 20, clientRequestId: randomUUID() });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect((await request('DELETE', `/v1/books/${id}`)).statusCode).toBe(204);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.xp).toBe(before.xp);
    expect(await prisma.book.count({ where: { userId } })).toBe(0);
  });
});

describe('logging pages', () => {
  it('answers 201 with the score, the book, the level and the streak', async () => {
    const id = await addBook();
    const response = await request('POST', `/v1/books/${id}/logs`, {
      pages: 12,
      clientRequestId: randomUUID(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('logId');
    expect(body.pages).toBe(12);
    expect(body.score).toMatchObject({ goalReachedNow: true, goalMetToday: true });
    expect(body.book.progress.hp).toBe(188);
    expect(body.level).toHaveProperty('progress.level');
    expect(body.streak).toEqual({ current: 1, longest: 1 });
  });

  it('answers a retry with 200 and the original log', async () => {
    const id = await addBook();
    const payload = { pages: 5, clientRequestId: randomUUID() };
    const first = await request('POST', `/v1/books/${id}/logs`, payload);
    const retry = await request('POST', `/v1/books/${id}/logs`, payload);

    expect(retry.statusCode).toBe(200);
    expect(retry.json().logId).toBe(first.json().logId);
  });

  it('validates the page count', async () => {
    const id = await addBook();
    const response = await request('POST', `/v1/books/${id}/logs`, {
      pages: 0,
      clientRequestId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('today', () => {
  it('returns the summary the main screen reads', async () => {
    await addBook();
    const response = await request('GET', '/v1/today');

    expect(response.statusCode).toBe(200);
    const body = response.json();
    for (const key of [
      'date',
      'dailyGoal',
      'pagesToday',
      'goalMet',
      'streak',
      'daysRead',
      'windowDays',
      'suggestedGoal',
      'books',
    ]) {
      expect(body, `missing ${key}`).toHaveProperty(key);
    }
    expect(body.books).toHaveLength(1);
  });
});

describe('me', () => {
  it('returns the profile with progress and stats', async () => {
    const response = await request('GET', '/v1/me');

    expect(response.statusCode).toBe(200);
    const { profile } = response.json();
    expect(profile).toMatchObject({
      onboarded: false,
      locale: 'TR',
      progress: { level: 1 },
      streak: { current: 0, longest: 0 },
      stats: { totalPages: 0, booksFinished: 0, daysRead: 0 },
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('completes onboarding once, with the first book', async () => {
    const payload = {
      timezone: 'Europe/Istanbul',
      locale: 'EN',
      dailyGoal: 5,
      reminderTime: '21:30',
      firstBook: { title: 'The Little Prince', pageCount: 96 },
    };
    const response = await request('POST', '/v1/me/onboarding', payload);

    expect(response.statusCode).toBe(200);
    expect(response.json().profile).toMatchObject({
      onboarded: true,
      locale: 'EN',
      dailyGoal: 5,
      reminderTime: '21:30',
    });
    expect(await prisma.book.count({ where: { userId } })).toBe(1);

    const again = await request('POST', '/v1/me/onboarding', payload);
    expect(again.statusCode).toBe(409);
  });

  it('only accepts the offered daily goals', async () => {
    const response = await request('PATCH', '/v1/me', { dailyGoal: 7 });
    expect(response.statusCode).toBe(400);
  });

  it('restarts the goal review clock only when the goal changes', async () => {
    const old = new Date('2026-01-01T00:00:00Z');
    await prisma.user.update({ where: { id: userId }, data: { goalSetAt: old, dailyGoal: 10 } });

    await request('PATCH', '/v1/me', { dailyGoal: 10, displayName: 'Yeni ad' });
    let user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.goalSetAt.getTime()).toBe(old.getTime());

    await request('PATCH', '/v1/me', { dailyGoal: 20 });
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.goalSetAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('turns the reminder off with null and rejects a malformed time', async () => {
    expect((await request('PATCH', '/v1/me', { reminderTime: '25:00' })).statusCode).toBe(400);
    const response = await request('PATCH', '/v1/me', { reminderTime: null });
    expect(response.json().profile.reminderTime).toBeNull();
  });

  it('registers a push token and moves it between accounts', async () => {
    const token = `ExponentPushToken[${PREFIX}${randomUUID()}]`;
    expect(
      (await request('POST', '/v1/me/push-tokens', { token, platform: 'IOS' })).statusCode,
    ).toBe(204);

    const other = await prisma.user.create({
      data: { username: `${PREFIX}second`, displayName: 'B', email: `${PREFIX}second@example.com` },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/me/push-tokens',
      headers: { 'x-dev-user-id': other.id },
      payload: { token, platform: 'ANDROID' },
    });
    const row = await prisma.pushToken.findUniqueOrThrow({ where: { token } });
    expect(row.userId).toBe(other.id);
  });

  it('exports the account without the password hash', async () => {
    await addBook();
    const response = await request('GET', '/v1/me/export');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    const body = response.json();
    expect(body.user.books).toHaveLength(1);
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('closes the account on deletion', async () => {
    const response = await request('DELETE', '/v1/me');
    expect(response.statusCode).toBe(202);
    expect(response.json()).toHaveProperty('purgeEligibleAt');

    const after = await request('GET', '/v1/me');
    expect(after.statusCode).toBe(401);
  });
});
