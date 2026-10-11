/**
 * Account erasure.
 *
 * Runs the task function directly against a real Postgres. No Redis, no BullMQ —
 * that is the whole point of `tasks/` taking a `JobContext` rather than a `Job`.
 *
 * Everything is namespaced with `test_job_erase_` and cleaned up by that prefix.
 * Nothing here counts rows globally: the development seed is in the same database and
 * a global count would make this file fail for reasons that have nothing to do with it.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ACCOUNT_ERASURE_RETENTION_DAYS } from '../constants.js';
import type { JobContext } from '../context.js';
import { createLogger } from '../logger.js';
import { erasureCutoff, runAccountErasure } from '../tasks/account-erasure.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_erase_';

/** Frozen: the retention window is arithmetic on this instant. */
const NOW = new Date('2024-06-01T03:20:00.000Z');
const DAY = 86_400_000;

let expiredId: string;
let recentId: string;
let activeId: string;

function context(now: Date = NOW): JobContext {
  return {
    prisma,
    now,
    // Silenced: these tests assert on the database, not on stdout.
    logger: createLogger({ level: 'fatal', name: 'test', write: () => {} }),
  };
}

async function makeUser(suffix: string, deletedAt: Date | null = null): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
      deletedAt,
      books: { create: { title: 'Kitap', pageCount: 100, pagesRead: 10 } },
    },
  });
  return user.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  // 40 days deleted: comfortably past the retention window.
  expiredId = await makeUser('expired', new Date(NOW.getTime() - 40 * DAY));
  // 5 days deleted: still inside the window, and must survive untouched.
  recentId = await makeUser('recent', new Date(NOW.getTime() - 5 * DAY));
  activeId = await makeUser('active');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('erasureCutoff', () => {
  it('is exactly the retention window before now', () => {
    expect(erasureCutoff(NOW, 30).toISOString()).toBe('2024-05-02T03:20:00.000Z');
  });

  it('defaults to the window the API already promised the user', () => {
    expect(erasureCutoff(NOW).getTime()).toBe(
      erasureCutoff(NOW, ACCOUNT_ERASURE_RETENTION_DAYS).getTime(),
    );
  });
});

describe('runAccountErasure', () => {
  it('hard-deletes an expired account together with its books', async () => {
    const result = await runAccountErasure(context());

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(await prisma.user.findUnique({ where: { id: expiredId } })).toBeNull();
    expect(await prisma.book.count({ where: { userId: expiredId } })).toBe(0);
  });

  it('leaves an account that is still inside the window', async () => {
    await runAccountErasure(context());

    const survivor = await prisma.user.findUnique({ where: { id: recentId } });
    expect(survivor?.deletedAt).not.toBeNull();
  });

  it('never touches a live account', async () => {
    await runAccountErasure(context());

    expect(await prisma.user.findUnique({ where: { id: activeId } })).not.toBeNull();
    expect(await prisma.book.count({ where: { userId: activeId } })).toBe(1);
  });

  it('is idempotent: a second run purges nothing more of this fixture', async () => {
    await runAccountErasure(context());
    await runAccountErasure(context());

    expect(await prisma.user.findUnique({ where: { id: recentId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: activeId } })).not.toBeNull();
  });
});
