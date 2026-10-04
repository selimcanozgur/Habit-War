/**
 * Pausing a session: paused time is not credited, a pause counts as an
 * interruption, and pause/resume are safe to repeat.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { SessionService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_pause_';
const MINUTE = 60_000;

let clock = new Date('2024-06-03T08:00:00.000Z');
const now = (): Date => clock;
const advance = (minutes: number): void => {
  clock = new Date(clock.getTime() + minutes * MINUTE);
};

let service: SessionService;
let userId: string;
let habitId: string;

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-06-03T08:00:00.000Z');
  service = new SessionService({ prisma, now });
  const user = await prisma.user.create({
    data: { username: `${PREFIX}u`, displayName: 'u', email: `${PREFIX}u@example.com` },
  });
  userId = user.id;
  const habit = await prisma.habit.create({
    data: { userId, name: 'Okuma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
  });
  habitId = habit.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('pause and resume', () => {
  it('credits only the time the session was running', async () => {
    const session = await service.start({ userId, habitId, clientRequestId: `${PREFIX}1` });
    advance(10);
    await service.pause(userId, session.id);
    advance(30); // paused: not credited
    await service.resume(userId, session.id);
    advance(5);

    const result = await service.complete({
      userId,
      sessionId: session.id,
      clientRequestId: `${PREFIX}1`,
      interruptions: 0,
      verification: 'TIMER_ONLY',
    });

    expect(result.session.durationSec).toBe(15 * 60);
    // One pause is one interruption.
    expect(result.session.interruptions).toBe(1);
  });

  it('does not credit a pause still running at completion', async () => {
    const session = await service.start({ userId, habitId, clientRequestId: `${PREFIX}2` });
    advance(20);
    await service.pause(userId, session.id);
    advance(60);

    const result = await service.complete({
      userId,
      sessionId: session.id,
      clientRequestId: `${PREFIX}2`,
      interruptions: 0,
      verification: 'TIMER_ONLY',
    });

    expect(result.session.durationSec).toBe(20 * 60);
  });

  it('counts a repeated pause once and adds a repeated resume once', async () => {
    const session = await service.start({ userId, habitId, clientRequestId: `${PREFIX}3` });
    advance(5);
    await service.pause(userId, session.id);
    await service.pause(userId, session.id);
    advance(10);
    await service.resume(userId, session.id);
    const again = await service.resume(userId, session.id);

    expect(again.pauseCount).toBe(1);
    expect(again.pausedSec).toBe(10 * 60);
    expect(again.pausedAt).toBeNull();
  });

  it('keeps a paused session alive past the plain length cap', async () => {
    const session = await service.start({ userId, habitId, clientRequestId: `${PREFIX}4` });
    await service.pause(userId, session.id);
    // Past MAX_SESSION_MINUTES (240) of wall time, inside the pause budget.
    advance(250);

    const active = await service.active(userId);
    expect(active?.id).toBe(session.id);
  });

  it('refuses to pause a session that is not running', async () => {
    const session = await service.start({ userId, habitId, clientRequestId: `${PREFIX}5` });
    await service.abandon(userId, session.id);
    await expect(service.pause(userId, session.id)).rejects.toMatchObject({ statusCode: 422 });
  });
});
