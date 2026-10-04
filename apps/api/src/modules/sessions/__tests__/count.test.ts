/**
 * Count habits: quick logs scored as the sessions they are worth, capped at the
 * day's target, idempotent, and hitting the hunted monster like any session.
 */

import { COUNT_TARGET_MINUTES } from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { HuntService } from '../../game/hunts.js';
import { SessionService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_count_';

// Midday in Istanbul, so every log lands on one local day.
let clock = new Date('2024-06-05T09:00:00.000Z');
const now = (): Date => clock;
const tick = (): void => {
  clock = new Date(clock.getTime() + 60_000);
};

let service: SessionService;
let userId: string;
let pushupsId: string;
let counter = 0;
const key = (): string => `${PREFIX}${++counter}-${Date.now()}`;

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-06-05T09:00:00.000Z');
  service = new SessionService({ prisma, now });
  userId = (
    await prisma.user.create({
      data: {
        username: `${PREFIX}u`,
        displayName: 'u',
        email: `${PREFIX}u@example.com`,
        timezone: 'Europe/Istanbul',
      },
    })
  ).id;
  pushupsId = (
    await prisma.habit.create({
      data: {
        userId,
        name: 'Şınav',
        category: 'FITNESS',
        stat: 'STR',
        targetMinutes: 15,
        kind: 'COUNT',
        targetCount: 50,
        unit: 'tekrar',
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function log(count: number, requestId = key()) {
  const result = await service.logCount({ userId, habitId: pushupsId, count, clientRequestId: requestId });
  tick();
  return result;
}

describe('logCount', () => {
  it('credits exactly the target minutes over the day, however it is split', async () => {
    let seconds = 0;
    for (const count of [5, 5, 10, 30]) {
      const result = await log(count);
      seconds += result.session.durationSec ?? 0;
      expect(result.session.count).toBe(count);
    }
    expect(Math.round(seconds / 60)).toBe(COUNT_TARGET_MINUTES);
  });

  it('pays XP up to the target and nothing past it', async () => {
    const atTarget = await log(50);
    expect(atTarget.xp).toBeGreaterThan(0);
    const past = await log(50);
    expect(past.xp).toBe(0);
    expect(past.session.count).toBe(50);
  });

  it('is idempotent: a retried log counts once', async () => {
    const requestId = key();
    const first = await log(10, requestId);
    const again = await log(10, requestId);
    expect(again.session.id).toBe(first.session.id);
    expect(again.replayed).toBe(true);
    expect(await prisma.session.count({ where: { habitId: pushupsId } })).toBe(1);
  });

  it('refuses a timed habit', async () => {
    const reading = await prisma.habit.create({
      data: { userId, name: 'Okuma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
    });
    await expect(
      service.logCount({ userId, habitId: reading.id, count: 5, clientRequestId: key() }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('hits the hunted monster like any session', async () => {
    await new HuntService({ prisma, now }).bestiary(userId); // starts the first monster
    tick();
    const result = await log(25);
    expect(result.monster?.damage ?? 0).toBeGreaterThan(0);
  });
});
