/**
 * Duel settlement.
 *
 * The bug this job exists for is invisible from any single request: a duel expires,
 * neither player opens the app, and the row stays ACTIVE forever. So the assertions
 * are about what happens with NOBODY looking — the duel closes, the winner is written
 * from the ledger, and both sides are told.
 *
 * The clock is frozen in 2024, which is also what isolates the file: the development
 * seed's running duel ends days after the seed ran, so it is not expired relative to
 * this `now` and the job cannot touch it.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobContext } from '../context.js';
import { createLogger } from '../logger.js';
import { decideDuelWinner, duelOutcomeFor, runDuelSettlement } from '../tasks/duel-settlement.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_duel_';

const NOW = new Date('2024-06-01T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;

let winnerUserId: string;
let loserUserId: string;
let drawAId: string;
let drawBId: string;
let expiredDuelId: string;
let drawDuelId: string;
let runningDuelId: string;

function context(now: Date = NOW): JobContext {
  return {
    prisma,
    now,
    logger: createLogger({ level: 'fatal', name: 'test', write: () => {} }),
  };
}

async function makeUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
    },
  });
  return user.id;
}

/**
 * A completed session plus its ledger row, dated inside the duel window.
 *
 * Written by hand rather than through SessionService: the duel score is derived from
 * XpLedger, and the point here is to control that number exactly, not to re-test the
 * XP engine.
 */
async function awardXp(userId: string, habitId: string, amount: number, at: Date): Promise<void> {
  const session = await prisma.session.create({
    data: {
      userId,
      habitId,
      clientRequestId: `${PREFIX}${userId}_${at.getTime()}_${amount}`,
      startedAt: at,
      endedAt: new Date(at.getTime() + 30 * 60_000),
      durationSec: 1800,
      status: 'COMPLETED',
      xpAwarded: amount,
    },
  });
  await prisma.xpLedger.create({
    data: { userId, amount, reason: 'SESSION_AWARD', sessionId: session.id, createdAt: at },
  });
}

async function studyHabit(userId: string): Promise<string> {
  const habit = await prisma.habit.create({
    data: { userId, name: 'Ders çalışma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
  });
  return habit.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();

  winnerUserId = await makeUser('winner');
  loserUserId = await makeUser('loser');
  drawAId = await makeUser('drawa');
  drawBId = await makeUser('drawb');

  const startsAt = new Date(NOW.getTime() - 5 * DAY);
  const midWindow = new Date(NOW.getTime() - 3 * DAY);

  await awardXp(winnerUserId, await studyHabit(winnerUserId), 120, midWindow);
  await awardXp(loserUserId, await studyHabit(loserUserId), 45, midWindow);

  // Expired an hour ago: the clock ran out and nobody opened the app.
  const expired = await prisma.challenge.create({
    data: {
      challengerId: winnerUserId,
      opponentId: loserUserId,
      category: 'STUDY',
      status: 'ACTIVE',
      startsAt,
      endsAt: new Date(NOW.getTime() - HOUR),
    },
  });
  expiredDuelId = expired.id;

  // Two players, no sessions at all: 0 – 0.
  const draw = await prisma.challenge.create({
    data: {
      challengerId: drawAId,
      opponentId: drawBId,
      category: 'STUDY',
      status: 'ACTIVE',
      startsAt,
      endsAt: new Date(NOW.getTime() - HOUR),
    },
  });
  drawDuelId = draw.id;

  // Still running: must not be touched.
  const running = await prisma.challenge.create({
    data: {
      challengerId: winnerUserId,
      opponentId: drawAId,
      category: 'FITNESS',
      status: 'ACTIVE',
      startsAt,
      endsAt: new Date(NOW.getTime() + DAY),
    },
  });
  runningDuelId = running.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('decideDuelWinner', () => {
  const pair = { challengerId: 'a', opponentId: 'b' };

  it('returns the higher total', () => {
    expect(decideDuelWinner(pair, 10, 4)).toBe('a');
    expect(decideDuelWinner(pair, 4, 10)).toBe('b');
  });

  /** The case a `>` alone gets wrong: a tie must not hand the challenger the win. */
  it('returns null on a tie, including 0 – 0', () => {
    expect(decideDuelWinner(pair, 7, 7)).toBeNull();
    expect(decideDuelWinner(pair, 0, 0)).toBeNull();
  });
});

describe('duelOutcomeFor', () => {
  it('reads the same result from each side', () => {
    expect(duelOutcomeFor('a', 'a')).toBe('WON');
    expect(duelOutcomeFor('b', 'a')).toBe('LOST');
    expect(duelOutcomeFor('a', null)).toBe('DRAW');
  });
});

describe('runDuelSettlement', () => {
  it('closes an expired duel and writes the winner from the ledger', async () => {
    const result = await runDuelSettlement(context());

    expect(result.processed).toBeGreaterThanOrEqual(2);

    const duel = await prisma.challenge.findUniqueOrThrow({ where: { id: expiredDuelId } });
    expect(duel.status).toBe('COMPLETED');
    expect(duel.winnerId).toBe(winnerUserId);
    expect(duel.challengerXp).toBe(120);
    expect(duel.opponentXp).toBe(45);
    expect(duel.settledAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('settles a tie as COMPLETED with no winner', async () => {
    await runDuelSettlement(context());

    const duel = await prisma.challenge.findUniqueOrThrow({ where: { id: drawDuelId } });
    expect(duel.status).toBe('COMPLETED');
    expect(duel.winnerId).toBeNull();
    expect(duel.settledAt).not.toBeNull();
  });

  it('leaves a duel whose clock is still running', async () => {
    await runDuelSettlement(context());

    const duel = await prisma.challenge.findUniqueOrThrow({ where: { id: runningDuelId } });
    expect(duel.status).toBe('ACTIVE');
    expect(duel.settledAt).toBeNull();
  });

  it('tells both players, in Turkish, without naming the opponent', async () => {
    await runDuelSettlement(context());

    const notifications = await prisma.notification.findMany({
      where: { targetId: expiredDuelId, type: 'CHALLENGE_ENDED' },
      orderBy: { userId: 'asc' },
    });
    expect(notifications).toHaveLength(2);

    const toWinner = notifications.find((row) => row.userId === winnerUserId);
    const toLoser = notifications.find((row) => row.userId === loserUserId);

    expect(toWinner?.title).toBe('Düelloyu kazandın');
    expect(toWinner?.body).toContain('120 XP – 45 XP');
    expect(toLoser?.title).toBe('Düello sona erdi');
    // The score is shown from the recipient's own side.
    expect(toLoser?.body).toContain('45 XP – 120 XP');

    // System copy: no actor, so a blocked or purged opponent cannot suppress a result.
    expect(toWinner?.actorId).toBeNull();
    expect(toWinner?.targetType).toBe('CHALLENGE');
  });

  it('is idempotent: a second run settles nothing and notifies nobody twice', async () => {
    await runDuelSettlement(context());
    // An hour later, as the hourly schedule would: the duel must already be finished.
    await runDuelSettlement(context(new Date(NOW.getTime() + HOUR)));

    const notifications = await prisma.notification.count({
      where: { targetId: expiredDuelId, type: 'CHALLENGE_ENDED' },
    });
    expect(notifications).toBe(2);

    // The result recorded by the first run is untouched by the second.
    const duel = await prisma.challenge.findUniqueOrThrow({ where: { id: expiredDuelId } });
    expect(duel.settledAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('does not notify an account that has since been soft-deleted', async () => {
    await prisma.user.update({ where: { id: loserUserId }, data: { deletedAt: NOW } });

    await runDuelSettlement(context());

    const duel = await prisma.challenge.findUniqueOrThrow({ where: { id: expiredDuelId } });
    expect(duel.status).toBe('COMPLETED');

    const recipients = await prisma.notification.findMany({
      where: { targetId: expiredDuelId, type: 'CHALLENGE_ENDED' },
      select: { userId: true },
    });
    expect(recipients.map((row) => row.userId)).toEqual([winnerUserId]);
  });
});
