/**
 * Stale session sweep.
 *
 * Small job, two things worth proving: the cutoff is the domain's own
 * `STALE_SESSION_MINUTES` and not a number invented here, and a session that has
 * already been abandoned is not re-stamped by the next run — the sweep runs every 15
 * minutes, so a non-idempotent write would walk `endedAt` forward forever.
 */

import { STALE_SESSION_MINUTES } from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobContext } from '../context.js';
import { createLogger } from '../logger.js';
import { runStaleSessionSweep, staleSessionCutoff } from '../tasks/stale-session-sweep.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_stale_';

const NOW = new Date('2024-06-01T12:00:00.000Z');
const MINUTE = 60_000;

let userId: string;
let habitId: string;
let forgottenId: string;
let freshId: string;
let finishedId: string;
let logLines: string[];

function context(now: Date = NOW): JobContext {
  return {
    prisma,
    now,
    logger: createLogger({
      level: 'info',
      name: 'test',
      write: (line) => logLines.push(line),
    }),
  };
}

async function makeSession(
  suffix: string,
  startedMinutesAgo: number,
  status: 'ACTIVE' | 'COMPLETED',
): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      habitId,
      clientRequestId: `${PREFIX}${suffix}`,
      startedAt: new Date(NOW.getTime() - startedMinutesAgo * MINUTE),
      status,
      ...(status === 'COMPLETED'
        ? { endedAt: new Date(NOW.getTime() - (startedMinutesAgo - 30) * MINUTE), durationSec: 1800 }
        : {}),
    },
  });
  return session.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  logLines = [];

  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}user`,
      displayName: 'Unutkan',
      email: `${PREFIX}user@example.com`,
    },
  });
  userId = user.id;

  const habit = await prisma.habit.create({
    data: { userId, name: 'Koşu', category: 'FITNESS', stat: 'END', targetMinutes: 30 },
  });
  habitId = habit.id;

  // A timer left running overnight: an hour past the stale cutoff.
  forgottenId = await makeSession('forgotten', STALE_SESSION_MINUTES + 60, 'ACTIVE');
  // Running for an hour. Legitimate, and the user is still in it.
  freshId = await makeSession('fresh', 60, 'ACTIVE');
  // Old but already finished; the sweep must not rewrite finished history.
  finishedId = await makeSession('finished', STALE_SESSION_MINUTES + 60, 'COMPLETED');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('staleSessionCutoff', () => {
  it('is STALE_SESSION_MINUTES before now', () => {
    expect(NOW.getTime() - staleSessionCutoff(NOW).getTime()).toBe(STALE_SESSION_MINUTES * MINUTE);
  });
});

describe('runStaleSessionSweep', () => {
  it('abandons a session left running past the creditable maximum', async () => {
    const result = await runStaleSessionSweep(context());

    expect(result.processed).toBeGreaterThanOrEqual(1);

    const forgotten = await prisma.session.findUniqueOrThrow({ where: { id: forgottenId } });
    expect(forgotten.status).toBe('ABANDONED');
    expect(forgotten.endedAt?.toISOString()).toBe(NOW.toISOString());
    // Nothing was credited: an abandoned session has no duration to score.
    expect(forgotten.durationSec).toBeNull();
    expect(forgotten.xpAwarded).toBe(0);
  });

  it('leaves a session that is still inside the window', async () => {
    await runStaleSessionSweep(context());

    const fresh = await prisma.session.findUniqueOrThrow({ where: { id: freshId } });
    expect(fresh.status).toBe('ACTIVE');
    expect(fresh.endedAt).toBeNull();
  });

  it('does not touch sessions that already finished', async () => {
    await runStaleSessionSweep(context());

    const finished = await prisma.session.findUniqueOrThrow({ where: { id: finishedId } });
    expect(finished.status).toBe('COMPLETED');
    expect(finished.durationSec).toBe(1800);
  });

  it('is idempotent: a later run does not move endedAt forward', async () => {
    await runStaleSessionSweep(context());
    // Fifteen minutes later, as the schedule would fire it.
    await runStaleSessionSweep(context(new Date(NOW.getTime() + 15 * MINUTE)));

    const forgotten = await prisma.session.findUniqueOrThrow({ where: { id: forgottenId } });
    expect(forgotten.endedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('logs how many rows it changed', async () => {
    await runStaleSessionSweep(context());

    const summary = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const finished = summary.find((entry) => entry['msg'] === 'stale session sweep finished');
    expect(finished).toBeDefined();
    expect(finished?.['abandoned']).toBeGreaterThanOrEqual(1);
  });
});
