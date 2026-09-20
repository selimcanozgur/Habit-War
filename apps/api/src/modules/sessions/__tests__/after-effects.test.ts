/**
 * Session completion side effects.
 *
 * These exist because three subsystems were written, tested in isolation, and then
 * never called from the one path that should drive them. The Season model had no
 * effect on any XP award, badges could not unlock through normal play, and the feed
 * received nothing automatically — all while every unit test passed, because each
 * piece worked perfectly on its own.
 *
 * So the assertions here are deliberately about the *wiring*: that finishing a
 * session moves the other subsystems, and that a failure in one of them cannot cost
 * the user the XP they actually earned.
 */

import { PrismaClient } from '@prisma/client';
import { EVENT_MULTIPLIER_MAX } from '@habitwar/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { syncAchievementCatalog } from '../../game/achievements.js';
import { SessionService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_fx_';

let service: SessionService;
let userId: string;
let habitId: string;
let clock: Date;

/** Frozen clock so a digest and a session cannot land on different local days. */
function now(): Date {
  return clock;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PREFIX } } });
  await prisma.season.deleteMany({ where: { code: { startsWith: PREFIX } } });
}

/** Starts a session and rewinds it so completion credits real minutes. */
async function runSession(minutes: number, requestId: string): Promise<void> {
  const session = await service.start({ userId, habitId, clientRequestId: requestId });
  await prisma.session.update({
    where: { id: session.id },
    data: { startedAt: new Date(clock.getTime() - minutes * 60_000) },
  });
  await service.complete({
    userId,
    sessionId: session.id,
    clientRequestId: requestId,
    interruptions: 0,
    verification: 'TIMER_ONLY',
  });
}

beforeEach(async () => {
  await cleanup();
  // Deliberately far from "now": the development seed creates an active season around
  // whenever it last ran, and a test that silently inherits it is not testing its own
  // setup. Nothing else in the engine depends on the absolute date.
  clock = new Date('2024-03-15T18:00:00.000Z');
  service = new SessionService({ prisma, now });

  await syncAchievementCatalog(prisma);

  const user = await prisma.user.create({
    data: {
      clerkId: `${PREFIX}user`,
      username: `${PREFIX}user`,
      displayName: 'Efekt',
      email: `${PREFIX}user@example.com`,
      timezone: 'Europe/Istanbul',
    },
  });
  userId = user.id;

  const habit = await prisma.habit.create({
    data: { userId, name: 'Kitap okuma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
  });
  habitId = habit.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('season multiplier', () => {
  it('pays the same as baseline when no season is running', async () => {
    await runSession(30, `${PREFIX}r1`);
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    const breakdown = session.multiplierData as unknown as { event: number };
    expect(breakdown.event).toBe(1);
  });

  /**
   * The bug this catches: `eventMultiplier` was hardcoded to 1 in the write path, so
   * the entire Season model — schema, service, endpoint, seed row — changed nothing
   * about any XP award.
   */
  it('applies the active season multiplier to a real award', async () => {
    await prisma.season.create({
      data: {
        code: `${PREFIX}season`,
        name: 'Test Sezonu',
        theme: 'Test',
        eventMultiplier: 1.5,
        isActive: true,
        startsAt: new Date(clock.getTime() - 86_400_000),
        endsAt: new Date(clock.getTime() + 86_400_000),
      },
    });

    await runSession(30, `${PREFIX}r2`);

    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    const breakdown = session.multiplierData as unknown as { event: number };
    expect(breakdown.event).toBe(1.5);
    expect(session.xpAwarded).toBeGreaterThan(0);
  });

  it('ignores a season that has not started or has ended', async () => {
    await prisma.season.create({
      data: {
        code: `${PREFIX}past`,
        name: 'Geçmiş Sezon',
        theme: 'Test',
        eventMultiplier: 2,
        isActive: true,
        startsAt: new Date(clock.getTime() - 30 * 86_400_000),
        endsAt: new Date(clock.getTime() - 86_400_000),
      },
    });

    await runSession(30, `${PREFIX}r3`);
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect((session.multiplierData as unknown as { event: number }).event).toBe(1);
  });

  it('never exceeds the domain ceiling even if a season is misconfigured', async () => {
    await prisma.season.create({
      data: {
        code: `${PREFIX}absurd`,
        name: 'Hatalı Sezon',
        theme: 'Test',
        eventMultiplier: 99,
        isActive: true,
        startsAt: new Date(clock.getTime() - 86_400_000),
        endsAt: new Date(clock.getTime() + 86_400_000),
      },
    });

    await runSession(30, `${PREFIX}r4`);
    const session = await prisma.session.findFirstOrThrow({ where: { userId } });
    expect((session.multiplierData as unknown as { event: number }).event).toBe(
      EVENT_MULTIPLIER_MAX,
    );
  });
});

describe('achievement evaluation', () => {
  it('unlocks the first-session badge through ordinary play', async () => {
    await runSession(30, `${PREFIX}a1`);

    const held = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });
    expect(held.map((row) => row.achievement.code)).toContain('first_session');
  });

  it('reports the unlock back to the caller so the client can celebrate it', async () => {
    const session = await service.start({
      userId,
      habitId,
      clientRequestId: `${PREFIX}a2`,
    });
    await prisma.session.update({
      where: { id: session.id },
      data: { startedAt: new Date(clock.getTime() - 30 * 60_000) },
    });

    const result = await service.complete({
      userId,
      sessionId: session.id,
      clientRequestId: `${PREFIX}a2`,
      interruptions: 0,
      verification: 'TIMER_ONLY',
    });

    expect(result.unlockedAchievements).toContain('first_session');
  });

  it('does not award the same badge twice across sessions', async () => {
    await runSession(30, `${PREFIX}a3`);
    clock = new Date(clock.getTime() + 3_600_000);
    await runSession(30, `${PREFIX}a4`);

    const firstSession = await prisma.userAchievement.findMany({
      where: { userId, achievement: { code: 'first_session' } },
    });
    expect(firstSession).toHaveLength(1);
  });
});

describe('daily digest', () => {
  it('writes one digest post for the day rather than one post per session', async () => {
    await runSession(30, `${PREFIX}d1`);
    clock = new Date(clock.getTime() + 3_600_000);
    await runSession(20, `${PREFIX}d2`);
    clock = new Date(clock.getTime() + 3_600_000);
    await runSession(25, `${PREFIX}d3`);

    const digests = await prisma.post.findMany({ where: { authorId: userId, type: 'DAILY_DIGEST' } });
    expect(digests).toHaveLength(1);
  });

  it('accumulates the day into that single post', async () => {
    await runSession(30, `${PREFIX}d4`);
    const afterOne = await prisma.post.findFirstOrThrow({
      where: { authorId: userId, type: 'DAILY_DIGEST' },
    });
    const firstStats = afterOne.digestStats as unknown as { sessions: number; xp: number };

    clock = new Date(clock.getTime() + 3_600_000);
    await runSession(30, `${PREFIX}d5`);

    const afterTwo = await prisma.post.findFirstOrThrow({
      where: { authorId: userId, type: 'DAILY_DIGEST' },
    });
    const secondStats = afterTwo.digestStats as unknown as { sessions: number; xp: number };

    expect(secondStats.sessions).toBe(firstStats.sessions + 1);
    expect(secondStats.xp).toBeGreaterThan(firstStats.xp);
  });

  it('opens a new digest when the local day rolls over', async () => {
    await runSession(30, `${PREFIX}d6`);
    clock = new Date(clock.getTime() + 2 * 86_400_000);
    await runSession(30, `${PREFIX}d7`);

    const digests = await prisma.post.findMany({ where: { authorId: userId, type: 'DAILY_DIGEST' } });
    expect(digests).toHaveLength(2);
  });
});

describe('failure isolation', () => {
  /**
   * The trade this encodes: a user who genuinely worked thirty minutes keeps the XP
   * even if a cosmetic side effect fails. Rolling back the award because a feed post
   * could not be written would cost them real minutes for a decorative failure.
   */
  it('still awards XP when an after-effect throws', async () => {
    const logged: string[] = [];
    const broken = new SessionService({
      prisma,
      now,
      log: { error: (_obj, msg) => logged.push(msg) },
      feed: {
        upsertDailyDigest: async () => {
          throw new Error('feed is down');
        },
      },
    });

    const requestId = `${PREFIX}f1`;
    const session = await broken.start({ userId, habitId, clientRequestId: requestId });
    await prisma.session.update({
      where: { id: session.id },
      data: { startedAt: new Date(clock.getTime() - 30 * 60_000) },
    });

    const result = await broken.complete({
      userId,
      sessionId: session.id,
      clientRequestId: requestId,
      interruptions: 0,
      verification: 'TIMER_ONLY',
    });

    expect(result.xp).toBeGreaterThan(0);
    expect(logged.join(' ')).toContain('digest');

    const ledger = await prisma.xpLedger.findMany({ where: { userId, sessionId: session.id } });
    expect(ledger).toHaveLength(1);

    // The badge evaluation is a separate try/catch, so it still ran.
    expect(result.unlockedAchievements).toContain('first_session');
  });
});
