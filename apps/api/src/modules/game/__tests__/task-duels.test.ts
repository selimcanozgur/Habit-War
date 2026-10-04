/**
 * Task duels: daily check-ins, disputes, and what a duel pays.
 *
 * Runs the service against Postgres with a clock the test moves, because every rule
 * here is about time — which duel day a moment falls on, the rolling 24-hour reward
 * limit, and a duel that settles once its window closes.
 */

import {
  DUEL_DAILY_REWARD_LIMIT,
  DUEL_DAY_XP,
  DUEL_MAX_LIVE,
  DUEL_PERFECT_XP,
  DUEL_WIN_XP,
} from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ChallengeService } from '../challenges.js';

const prisma = new PrismaClient();
const PREFIX = 'test_tduel_';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let clock = new Date('2024-06-01T09:00:00.000Z');
const now = (): Date => clock;
function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

let service: ChallengeService;
let aliceId: string;
let bobId: string;

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

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

async function cycleXp(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.cycleXp;
}

/** Alice challenges Bob to a task duel, Bob accepts. Returns the duel id. */
async function startDuel(days = 3, opponent = `${PREFIX}bob`): Promise<string> {
  const created = await service.create({
    userId: aliceId,
    opponentUsername: opponent,
    task: '50 şınav',
    days,
  });
  const opponentId = (await prisma.user.findFirstOrThrow({ where: { username: opponent } })).id;
  await service.accept(opponentId, created.id);
  return created.id;
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-06-01T09:00:00.000Z');
  service = new ChallengeService({ prisma, now });
  aliceId = await makeUser('alice');
  bobId = await makeUser('bob');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('check-in', () => {
  it('scores a day and pays its XP', async () => {
    const id = await startDuel();
    const view = await service.checkIn(aliceId, id, 'Sabah yaptım');

    expect(view.task).toBe('50 şınav');
    expect(view.currentDay).toBe(1);
    expect(view.challenger.score).toBe(1);
    expect(view.checkIns).toHaveLength(1);
    expect(view.checkIns[0]).toMatchObject({ userId: aliceId, day: 1, note: 'Sabah yaptım' });
    expect(await cycleXp(aliceId)).toBe(DUEL_DAY_XP);
  });

  it('is idempotent within a day: no second point, no second payment', async () => {
    const id = await startDuel();
    await service.checkIn(aliceId, id, null);
    const again = await service.checkIn(aliceId, id, null);

    expect(again.challenger.score).toBe(1);
    expect(await cycleXp(aliceId)).toBe(DUEL_DAY_XP);
  });

  it('counts each 24-hour slice of the duel as its own day', async () => {
    const id = await startDuel();
    await service.checkIn(aliceId, id, null);
    advance(DAY);
    const view = await service.checkIn(aliceId, id, null);

    expect(view.currentDay).toBe(2);
    expect(view.challenger.score).toBe(2);
  });

  it('stops paying past the daily reward limit, but still scores', async () => {
    // One duel per opponent, so the limit is crossed across several duels in a day.
    const ids: string[] = [];
    for (let i = 0; i <= DUEL_DAILY_REWARD_LIMIT; i++) {
      await makeUser(`friend${i}`);
      ids.push(await startDuel(3, `${PREFIX}friend${i}`));
    }
    let last;
    for (const id of ids) last = await service.checkIn(aliceId, id, null);

    expect(last?.challenger.score).toBe(1);
    expect(await cycleXp(aliceId)).toBe(DUEL_DAILY_REWARD_LIMIT * DUEL_DAY_XP);
  });

  it('refuses a check-in before the duel is accepted', async () => {
    const created = await service.create({
      userId: aliceId,
      opponentUsername: `${PREFIX}bob`,
      task: '50 şınav',
      days: 3,
    });
    await expect(service.checkIn(aliceId, created.id, null)).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});

describe('dispute', () => {
  it('stops the day counting, takes its XP back, and tells the player who disputed', async () => {
    const id = await startDuel();
    const checkedIn = await service.checkIn(aliceId, id, null);
    const checkInId = checkedIn.checkIns[0]?.id as string;

    const view = await service.dispute(bobId, id, checkInId);

    expect(view.challenger.score).toBe(0);
    expect(view.checkIns[0]?.disputed).toBe(true);
    expect(await cycleXp(aliceId)).toBe(0);

    const inbox = await prisma.notification.findMany({ where: { userId: aliceId } });
    const notice = inbox.find((n) => n.type === 'CHALLENGE_DISPUTED');
    expect(notice?.actorId).toBe(bobId);
  });

  it('reverses only once, however many times it is disputed', async () => {
    const id = await startDuel();
    const checkInId = (await service.checkIn(aliceId, id, null)).checkIns[0]?.id as string;
    await service.dispute(bobId, id, checkInId);
    await service.dispute(bobId, id, checkInId);

    expect(await cycleXp(aliceId)).toBe(0);
  });

  it('does not let a player dispute their own check-in', async () => {
    const id = await startDuel();
    const checkInId = (await service.checkIn(aliceId, id, null)).checkIns[0]?.id as string;

    await expect(service.dispute(aliceId, id, checkInId)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('settlement', () => {
  it('pays the winner and the perfect bonus, and the loser keeps their day XP', async () => {
    const id = await startDuel(3);
    for (let day = 0; day < 3; day++) {
      await service.checkIn(aliceId, id, null);
      if (day === 0) await service.checkIn(bobId, id, null);
      advance(DAY);
    }

    // Reading the list after the window closes settles the duel.
    const { past } = await service.list(aliceId, 20);
    const settled = past.find((duel) => duel.id === id);

    expect(settled?.status).toBe('COMPLETED');
    expect(settled?.winnerId).toBe(aliceId);
    expect(await cycleXp(aliceId)).toBe(3 * DUEL_DAY_XP + DUEL_WIN_XP + DUEL_PERFECT_XP);
    expect(await cycleXp(bobId)).toBe(DUEL_DAY_XP);
  });

  it('pays nothing for a duel nobody worked on', async () => {
    const id = await startDuel(3);
    advance(3 * DAY);
    const { past } = await service.list(aliceId, 20);

    expect(past.find((duel) => duel.id === id)?.status).toBe('COMPLETED');
    expect(await cycleXp(aliceId)).toBe(0);
    expect(await cycleXp(bobId)).toBe(0);
  });

  it('pays the settlement bonus exactly once', async () => {
    const id = await startDuel(3);
    await service.checkIn(aliceId, id, null);
    advance(3 * DAY);
    await service.list(aliceId, 20);
    await service.list(bobId, 20);

    expect(await cycleXp(aliceId)).toBe(DUEL_DAY_XP + DUEL_WIN_XP);
  });
});

describe('live duel cap', () => {
  it(`refuses a duel beyond ${DUEL_MAX_LIVE} live ones`, async () => {
    for (let i = 0; i < DUEL_MAX_LIVE; i++) {
      await makeUser(`cap${i}`);
      await service.create({
        userId: aliceId,
        opponentUsername: `${PREFIX}cap${i}`,
        task: '50 şınav',
        days: 3,
      });
    }
    await expect(
      service.create({ userId: aliceId, opponentUsername: `${PREFIX}bob`, task: '50 şınav', days: 3 }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
