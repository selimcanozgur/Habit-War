/**
 * Account erasure.
 *
 * The assertions that matter are not "the row is gone" — that is one `delete` and a
 * foreign key. They are about the BLAST RADIUS: what the cascade takes with it, and
 * what has to be pulled out of its path first. A purge that also erased somebody
 * else's report about this account, or the moderation trail proving the account was
 * warned, would be a compliance failure that nobody notices until it is asked for in
 * writing.
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

import { createLogger } from '../logger.js';
import type { JobContext } from '../context.js';
import { erasureCutoff, runAccountErasure } from '../tasks/account-erasure.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_erase_';

/** Frozen: the retention window is arithmetic on this instant. */
const NOW = new Date('2024-06-01T03:20:00.000Z');
const DAY = 86_400_000;

let victimId: string;
let recentlyDeletedId: string;
let reporterId: string;
let moderatorId: string;
let bystanderPostId: string;
let thirdPartyReportId: string;
let victimsOwnReportId: string;
let moderationActionId: string;

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
    },
  });
  return user.id;
}

async function cleanup(): Promise<void> {
  // ModerationAction.actorId is SetNull and subjectUserId is nulled by the purge, so
  // a row can outlive every user this file created. `reason` is required, so it
  // carries the prefix and doubles as the cleanup handle.
  await prisma.moderationAction.deleteMany({ where: { reason: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();

  // 40 days deleted: comfortably past ACCOUNT_ERASURE_RETENTION_DAYS (30).
  victimId = await makeUser('victim', new Date(NOW.getTime() - 40 * DAY));
  // 5 days deleted: still inside the window, and must survive untouched.
  recentlyDeletedId = await makeUser('recent', new Date(NOW.getTime() - 5 * DAY));
  reporterId = await makeUser('reporter');
  moderatorId = await makeUser('moderator');

  // A bystander's post the victim interacted with. The counters are seeded to match
  // the rows, so a wrong repair is visible as a counter that no longer does.
  const bystanderPost = await prisma.post.create({
    data: {
      authorId: reporterId,
      type: 'TEXT',
      content: 'Üçüncü kişinin gönderisi',
      likeCount: 3,
      commentCount: 2,
    },
  });
  bystanderPostId = bystanderPost.id;

  await prisma.postLike.create({ data: { postId: bystanderPostId, userId: victimId } });
  await prisma.post.create({
    data: { authorId: victimId, type: 'TEXT', content: 'Yorum', parentId: bystanderPostId },
  });

  // Somebody else's report ABOUT the victim. Must survive the purge, anonymised.
  const thirdPartyReport = await prisma.report.create({
    data: { reporterId, reportedUserId: victimId, reason: 'HARASSMENT', status: 'ACTION_TAKEN' },
  });
  thirdPartyReportId = thirdPartyReport.id;

  // The victim's OWN report about somebody else. Cascades away with them — it is
  // their writing about themselves and others, and erasure means erasure.
  const victimsOwnReport = await prisma.report.create({
    data: { reporterId: victimId, reportedUserId: reporterId, reason: 'SPAM' },
  });
  victimsOwnReportId = victimsOwnReport.id;

  const action = await prisma.moderationAction.create({
    data: {
      actorId: moderatorId,
      action: 'USER_WARNED',
      subjectUserId: victimId,
      reportId: thirdPartyReportId,
      reason: `${PREFIX} tekrarlayan taciz, ilk uyarı`,
    },
  });
  moderationActionId = action.id;
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
    // Not a literal 30: the point is that the job and SafetyService read one constant.
    expect(erasureCutoff(NOW).getTime()).toBe(erasureCutoff(NOW, 30).getTime());
  });
});

describe('runAccountErasure', () => {
  it('hard-deletes an account whose retention window has expired', async () => {
    const result = await runAccountErasure(context());

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(await prisma.user.findUnique({ where: { id: victimId } })).toBeNull();
  });

  it('leaves a soft-deleted account that is still inside the window', async () => {
    await runAccountErasure(context());

    const survivor = await prisma.user.findUnique({ where: { id: recentlyDeletedId } });
    expect(survivor).not.toBeNull();
    expect(survivor?.deletedAt).not.toBeNull();
  });

  it("keeps somebody else's report about the account, with the subject anonymised", async () => {
    await runAccountErasure(context());

    const report = await prisma.report.findUnique({ where: { id: thirdPartyReportId } });
    expect(report).not.toBeNull();
    // The report itself survives — the reporter's record and the SLA evidence.
    expect(report?.reporterId).toBe(reporterId);
    expect(report?.status).toBe('ACTION_TAKEN');
    // ...but it no longer points at a person.
    expect(report?.reportedUserId).toBeNull();
  });

  it('keeps the moderation audit trail, with the subject anonymised', async () => {
    await runAccountErasure(context());

    const action = await prisma.moderationAction.findUnique({ where: { id: moderationActionId } });
    expect(action).not.toBeNull();
    expect(action?.action).toBe('USER_WARNED');
    expect(action?.actorId).toBe(moderatorId);
    expect(action?.subjectUserId).toBeNull();
  });

  it("erases the account's own report, which is its own personal data", async () => {
    await runAccountErasure(context());

    expect(await prisma.report.findUnique({ where: { id: victimsOwnReportId } })).toBeNull();
  });

  it('corrects the denormalised counters the cascade would have falsified', async () => {
    await runAccountErasure(context());

    const post = await prisma.post.findUniqueOrThrow({ where: { id: bystanderPostId } });
    // One like and one comment left with the purged account, so both come down by one.
    expect(post.likeCount).toBe(2);
    expect(post.commentCount).toBe(1);
  });

  it('is idempotent: a second run changes nothing and never double-decrements', async () => {
    await runAccountErasure(context());
    const afterFirst = await prisma.post.findUniqueOrThrow({ where: { id: bystanderPostId } });

    const second = await runAccountErasure(context());

    const afterSecond = await prisma.post.findUniqueOrThrow({ where: { id: bystanderPostId } });
    expect(afterSecond.likeCount).toBe(afterFirst.likeCount);
    expect(afterSecond.commentCount).toBe(afterFirst.commentCount);
    expect(second.vanished).toBe(0);

    // The survivors are still exactly as the first run left them.
    expect(await prisma.user.findUnique({ where: { id: recentlyDeletedId } })).not.toBeNull();
    const report = await prisma.report.findUnique({ where: { id: thirdPartyReportId } });
    expect(report?.reportedUserId).toBeNull();
  });

  it('purges nothing when the window has not passed for anyone in this fixture', async () => {
    // A `now` three days after the soft delete: nothing of ours is eligible yet.
    const early = new Date(NOW.getTime() - 37 * DAY);
    await runAccountErasure(context(early));

    expect(await prisma.user.findUnique({ where: { id: victimId } })).not.toBeNull();
  });
});
