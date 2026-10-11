/**
 * ReadingService against a real Postgres, with an injected clock so "today",
 * "yesterday" and the goal review window are fixed.
 */

import { randomUUID } from 'node:crypto';

import {
  BOOK_FINISHED_XP,
  DAILY_GOAL_BONUS_XP,
  XP_PER_PAGE,
} from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ReadingService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_reading_';
const DAY = 86_400_000;

/** Noon in Istanbul, well clear of any day boundary. */
const NOW = new Date('2026-10-10T09:00:00.000Z');

let userId: string;
let bookId: string;

function serviceAt(now: Date = NOW): ReadingService {
  return new ReadingService({ prisma, now: () => now });
}

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

async function log(pages: number, at: Date = NOW, book: string = bookId) {
  return serviceAt(at).logPages({ userId, bookId: book, pages, clientRequestId: randomUUID() });
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}reader`,
      displayName: 'Okur',
      email: `${PREFIX}reader@example.com`,
      timezone: 'Europe/Istanbul',
      dailyGoal: 10,
      goalSetAt: daysBefore(30),
    },
  });
  userId = user.id;
  const book = await prisma.book.create({ data: { userId, title: 'Kitap', pageCount: 100 } });
  bookId = book.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('logPages', () => {
  it('records pages, pays XP and writes the ledger', async () => {
    const result = await log(5);

    expect(result.pages).toBe(5);
    expect(result.score.xp).toBe(5 * XP_PER_PAGE);
    expect(result.book.pagesRead).toBe(5);
    expect(result.book.progress.hp).toBe(95);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.xp).toBe(result.score.xp);
    const ledger = await prisma.xpLedger.aggregate({ where: { userId }, _sum: { amount: true } });
    expect(ledger._sum.amount).toBe(user.xp);
  });

  it('pays the goal bonus once, on the log that reaches the goal', async () => {
    const first = await log(6);
    const second = await log(6);
    const third = await log(6);

    expect(first.score.goalBonusXp).toBe(0);
    expect(second.score.goalBonusXp).toBe(DAILY_GOAL_BONUS_XP);
    expect(third.score.goalBonusXp).toBe(0);
  });

  it('stops at the last page and finishes the book', async () => {
    await log(95);
    const result = await log(30);

    expect(result.pages).toBe(5);
    expect(result.score.bookBonusXp).toBe(BOOK_FINISHED_XP);
    expect(result.book.status).toBe('FINISHED');
    expect(result.book.progress.defeated).toBe(true);
  });

  it('refuses to log against a finished book', async () => {
    await log(100);
    await expect(log(1)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("refuses someone else's book", async () => {
    const other = await prisma.user.create({
      data: { username: `${PREFIX}other`, displayName: 'B', email: `${PREFIX}other@example.com` },
    });
    const theirs = await prisma.book.create({
      data: { userId: other.id, title: 'Onların', pageCount: 50 },
    });
    await expect(log(5, NOW, theirs.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is idempotent on clientRequestId', async () => {
    const clientRequestId = randomUUID();
    const input = { userId, bookId, pages: 12, clientRequestId };
    const first = await serviceAt().logPages(input);
    const retry = await serviceAt().logPages(input);

    expect(retry.replayed).toBe(true);
    expect(retry.logId).toBe(first.logId);
    const book = await prisma.book.findUniqueOrThrow({ where: { id: bookId } });
    expect(book.pagesRead).toBe(12);
  });

  /** Two logs racing must not both read the other as unwritten and both pay the bonus. */
  it('pays the goal bonus once even for concurrent logs', async () => {
    const results = await Promise.all([log(10), log(10), log(10)]);
    const bonuses = results.filter((result) => result.score.goalBonusXp > 0);
    expect(bonuses).toHaveLength(1);
  });

  it('forgives one missed day and breaks on two', async () => {
    await log(10, daysBefore(4));
    await log(10, daysBefore(2)); // one day missed: forgiven
    let user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(2);

    await log(10, NOW); // yesterday missed: still one day, forgiven
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(3);

    await log(10, new Date(NOW.getTime() + 3 * DAY)); // two missed: broken
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.currentStreak).toBe(1);
    expect(user.longestStreak).toBe(3);
  });

  it('reports a level up', async () => {
    const result = await log(60);
    expect(result.level.fromLevel).toBe(1);
    expect(result.level.leveledUp).toBe(true);
  });
});

describe('today', () => {
  it('summarises the day', async () => {
    await log(4);
    const today = await serviceAt().today(userId);

    expect(today.date).toBe('2026-10-10');
    expect(today.pagesToday).toBe(4);
    expect(today.goalMet).toBe(false);
    expect(today.books).toHaveLength(1);
    expect(today.books[0]?.progress.hp).toBe(96);
  });

  it('counts distinct reading days in the window', async () => {
    await log(3, daysBefore(1));
    await log(3, daysBefore(1));
    await log(3, daysBefore(5));
    const today = await serviceAt().today(userId);
    expect(today.daysRead).toBe(2);
  });

  it('suggests a smaller goal after a week of mostly missing it', async () => {
    await log(10, daysBefore(1));
    const today = await serviceAt().today(userId);
    expect(today.suggestedGoal).toBe(5);
  });

  it('suggests nothing while the goal is mostly met', async () => {
    for (let day = 1; day <= 5; day++) await log(10, daysBefore(day));
    const today = await serviceAt().today(userId);
    expect(today.suggestedGoal).toBeNull();
  });

  it('gives a newly chosen goal a full week before judging it', async () => {
    await prisma.user.update({ where: { id: userId }, data: { goalSetAt: daysBefore(2) } });
    const today = await serviceAt().today(userId);
    expect(today.suggestedGoal).toBeNull();
  });
});
