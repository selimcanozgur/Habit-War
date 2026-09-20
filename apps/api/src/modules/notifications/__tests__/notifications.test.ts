/**
 * Notification generation.
 *
 * These exist because the inbox was written and then wired to almost nothing: the
 * table, the routes and the copy all worked, and the only events that produced a row
 * were the three in the friends module. Every assertion here is therefore about the
 * WIRING — that the event fires the right type at the right person — plus the three
 * rules that must hold at every single call site:
 *
 *   1. It never goes to the person who caused it.
 *   2. It never crosses a block, in either direction.
 *   3. A failure to notify never costs the user the action they took — except in
 *      moderation, where the inverse is true and is tested as such.
 *
 * Fixtures are per-test and prefixed. Nothing counts rows globally: the development
 * seed puts notifications in this database, and a global count would make these tests
 * fail for reasons that have nothing to do with notifications.
 */

import { PrismaClient } from '@prisma/client';
import type { Notification } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FeedService } from '../../feed/service.js';
import { ChallengeService } from '../../game/challenges.js';
import { ModerationService } from '../../moderation/service.js';
import { NotificationService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_notif_';

/** Frozen clock: a duel window and a suspension expiry must not drift mid-test. */
const CLOCK = new Date('2024-05-10T09:00:00.000Z');
function now(): Date {
  return CLOCK;
}

let feed: FeedService;
let challenges: ChallengeService;
let moderation: ModerationService;

let aliceId: string;
let bobId: string;
let carolId: string;
let modId: string;
let alicePostId: string;

async function makeUser(
  suffix: string,
  role: 'USER' | 'MODERATOR' = 'USER',
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      clerkId: `${PREFIX}${suffix}`,
      username: `${PREFIX}${suffix}`,
      displayName: suffix === 'alice' ? 'Ayşe' : suffix === 'bob' ? 'Burak' : suffix,
      email: `${PREFIX}${suffix}@example.com`,
      timezone: 'Europe/Istanbul',
      role,
    },
  });
  return user.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PREFIX } } });
}

/** Every notification this test's users received. Scoped, never global. */
async function inboxOf(userId: string): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

beforeEach(async () => {
  await cleanup();

  feed = new FeedService({ prisma, now });
  challenges = new ChallengeService({ prisma, now });
  moderation = new ModerationService({ prisma, now });

  aliceId = await makeUser('alice');
  bobId = await makeUser('bob');
  carolId = await makeUser('carol');
  modId = await makeUser('mod', 'MODERATOR');

  const post = await prisma.post.create({
    data: { authorId: aliceId, type: 'TEXT', content: 'Bugün 40 dakika okudum.' },
  });
  alicePostId = post.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('feed', () => {
  it('tells the author when someone likes their post', async () => {
    await feed.like(bobId, alicePostId);

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('POST_LIKE');
    expect(inbox[0]?.actorId).toBe(bobId);
    expect(inbox[0]?.targetType).toBe('POST');
    expect(inbox[0]?.targetId).toBe(alicePostId);
    // Copy is rendered at write time, so the name is frozen into the title.
    expect(inbox[0]?.title).toContain('Burak');
  });

  /**
   * The like endpoint is idempotent, so a retried request must not ping the author
   * again — and unlike/re-like is the cheapest attention farm there is.
   */
  it('does not notify twice for a repeated like', async () => {
    await feed.like(bobId, alicePostId);
    await feed.like(bobId, alicePostId);

    expect(await inboxOf(aliceId)).toHaveLength(1);
  });

  it('does not notify a user about their own like', async () => {
    await feed.like(aliceId, alicePostId);

    expect(await inboxOf(aliceId)).toHaveLength(0);
  });

  it('tells the author when someone comments, with the comment in the body', async () => {
    await feed.createReply({
      userId: bobId,
      parentId: alicePostId,
      content: 'Hangi kitabı okuyorsun?',
    });

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('POST_COMMENT');
    // The excerpt is the point: without it the user must open the app to find out
    // whether the comment mattered.
    expect(inbox[0]?.body).toContain('Hangi kitabı okuyorsun?');
    // The target is the PARENT, so the tap opens the thread rather than a stray reply.
    expect(inbox[0]?.targetId).toBe(alicePostId);
  });

  it('does not notify a user about their own comment', async () => {
    await feed.createReply({ userId: aliceId, parentId: alicePostId, content: 'Ek not.' });

    expect(await inboxOf(aliceId)).toHaveLength(0);
  });

  /**
   * A block closes the interaction before it can become a notification: the post is
   * reported as missing, so there is nothing to tell anyone about. 404 and not 403,
   * because a distinct "forbidden" would confirm the block exists.
   */
  it('refuses the interaction entirely when a block is in place', async () => {
    await prisma.block.create({ data: { blockerId: aliceId, blockedId: carolId } });

    await expect(feed.like(carolId, alicePostId)).rejects.toThrow(/not found/i);
    expect(await inboxOf(aliceId)).toHaveLength(0);
  });

  /**
   * The notification is a consequence of the like, never a precondition of it.
   * Rolling back a user's action because we could not tell someone else about it
   * inverts the importance of the two writes — and the user would watch their like
   * disappear for a reason that has nothing to do with them.
   */
  it('still records the like when the notification cannot be written', async () => {
    const reported: unknown[] = [];
    class ExplodingNotifications extends NotificationService {
      override async create(): Promise<void> {
        throw new Error('notification store is down');
      }
    }
    const brittle = new FeedService({
      prisma,
      now,
      notifications: new ExplodingNotifications({
        prisma,
        now,
        onError: (error) => reported.push(error),
      }),
    });

    const result = await brittle.like(bobId, alicePostId);

    expect(result.liked).toBe(true);
    expect(result.likeCount).toBe(1);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: alicePostId } });
    expect(post.likeCount).toBe(1);
    // Swallowed, but not silent: a notification table that has quietly stopped being
    // written to is the kind of outage nobody notices for a month.
    expect(reported).toHaveLength(1);
  });
});

/**
 * The guard every call site relies on rather than re-implementing. It is tested here
 * directly because most modules refuse a blocked interaction long before it reaches
 * a notification — which means this rule would otherwise be covered by nothing, and
 * it is the last line for any path that does not have its own visibility check.
 */
describe('the shared block guard', () => {
  it('drops a notification that would cross a block, in either direction', async () => {
    const notifications = new NotificationService({ prisma, now });

    // Alice blocked Carol.
    await prisma.block.create({ data: { blockerId: aliceId, blockedId: carolId } });
    await notifications.create({
      userId: aliceId,
      actorId: carolId,
      type: 'POST_LIKE',
      title: 'Carol gönderini beğendi',
    });
    expect(await inboxOf(aliceId)).toHaveLength(0);

    // And the reverse: Carol, who did the blocking, is equally unreachable by Alice.
    await notifications.create({
      userId: carolId,
      actorId: aliceId,
      type: 'POST_LIKE',
      title: 'Ayşe gönderini beğendi',
    });
    expect(await inboxOf(carolId)).toHaveLength(0);
  });

  it('still delivers between users with no block between them', async () => {
    const notifications = new NotificationService({ prisma, now });
    await prisma.block.create({ data: { blockerId: aliceId, blockedId: carolId } });

    await notifications.create({
      userId: aliceId,
      actorId: bobId,
      type: 'POST_LIKE',
      title: 'Burak gönderini beğendi',
    });

    expect(await inboxOf(aliceId)).toHaveLength(1);
  });
});

describe('duels', () => {
  async function openDuel(): Promise<string> {
    const duel = await challenges.create({
      userId: aliceId,
      opponentUsername: `${PREFIX}bob`,
      category: 'STUDY',
      days: 3,
    });
    return duel.id;
  }

  it('invites the opponent, pointing at the duel rather than a profile', async () => {
    const duelId = await openDuel();

    const inbox = await inboxOf(bobId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('CHALLENGE_INVITE');
    expect(inbox[0]?.actorId).toBe(aliceId);
    // The accept and decline buttons live on the duel.
    expect(inbox[0]?.targetType).toBe('CHALLENGE');
    expect(inbox[0]?.targetId).toBe(duelId);
    expect(inbox[0]?.body).toContain('Çalışma');
  });

  it('tells the challenger their duel was accepted, and their clock has started', async () => {
    const duelId = await openDuel();
    await challenges.accept(bobId, duelId);

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('CHALLENGE_ACCEPTED');
    expect(inbox[0]?.actorId).toBe(bobId);
    expect(inbox[0]?.targetId).toBe(duelId);
  });

  /** A decline is silent on purpose, exactly as a declined friend request is. */
  it('says nothing when a duel is declined', async () => {
    const duelId = await openDuel();
    await challenges.decline(bobId, duelId);

    expect(await inboxOf(aliceId)).toHaveLength(0);
  });

  it('tells BOTH players how a settled duel finished, as a system notice', async () => {
    const duelId = await openDuel();
    await challenges.accept(bobId, duelId);
    // Run the clock out. Settlement is lazy, so the next read performs it.
    await prisma.challenge.update({
      where: { id: duelId },
      data: { endsAt: new Date(CLOCK.getTime() - 1000) },
    });

    await challenges.list(aliceId, 10);

    for (const userId of [aliceId, bobId]) {
      const ended = (await inboxOf(userId)).filter((row) => row.type === 'CHALLENGE_ENDED');
      expect(ended).toHaveLength(1);
      // No actor: the sentence is about the reader, and a null actor survives the
      // opponent being blocked, deleted or purged in the meantime.
      expect(ended[0]?.actorId).toBeNull();
      expect(ended[0]?.targetId).toBe(duelId);
      // Neither player earned XP, so it is a draw from both sides.
      expect(ended[0]?.title).toContain('berabere');
    }
  });

  /**
   * Settlement is reachable from any read, so the conditional update is the only
   * thing standing between "the duel ended" and "the duel ended, four times".
   */
  it('announces a settled duel exactly once, however many reads settle it', async () => {
    const duelId = await openDuel();
    await challenges.accept(bobId, duelId);
    await prisma.challenge.update({
      where: { id: duelId },
      data: { endsAt: new Date(CLOCK.getTime() - 1000) },
    });

    await challenges.list(aliceId, 10);
    await challenges.list(bobId, 10);
    await challenges.list(aliceId, 10);

    const ended = (await inboxOf(aliceId)).filter((row) => row.type === 'CHALLENGE_ENDED');
    expect(ended).toHaveLength(1);
  });
});

describe('moderation', () => {
  const REASON = 'Tekrarlayan taciz içeriği, üçüncü uyarı sonrası.';

  it('tells a warned user what they were warned for', async () => {
    await moderation.warnUser(aliceId, modId, REASON);

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('MODERATION_ACTION');
    expect(inbox[0]?.body).toContain(REASON);
    // The moderator is never named: a user who learns who sanctioned them has a
    // target, and that is how moderation teams get harassed.
    expect(inbox[0]?.actorId).toBeNull();
  });

  it('tells a suspended user when the suspension ends, in their own timezone', async () => {
    await moderation.suspendUser({ userId: aliceId, moderatorId: modId, reason: REASON, days: 7 });

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.type).toBe('MODERATION_ACTION');
    // 10 May + 7 days, read in Europe/Istanbul.
    expect(inbox[0]?.body).toContain('17 Mayıs 2024');
    expect(inbox[0]?.body).toContain(REASON);
  });

  it('tells the author when their post is hidden, and again when it is restored', async () => {
    await moderation.hidePost({ postId: alicePostId, moderatorId: modId, reason: REASON });
    await moderation.restorePost(alicePostId, modId, 'İtiraz haklı bulundu.');

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(2);
    expect(inbox.every((row) => row.type === 'MODERATION_ACTION')).toBe(true);
    expect(inbox.every((row) => row.targetId === alicePostId)).toBe(true);

    const restored = inbox.find((row) => row.title.includes('yeniden yayında'));
    expect(restored).toBeDefined();
    // The moderator's internal note for the restore is not forwarded to the user.
    expect(restored?.body).not.toContain('İtiraz haklı bulundu.');
  });

  it('tells a reinstated user their account works again', async () => {
    await moderation.suspendUser({ userId: aliceId, moderatorId: modId, reason: REASON, days: 30 });
    await moderation.reinstateUser(aliceId, modId, 'İtiraz kabul edildi.');

    const inbox = await inboxOf(aliceId);
    expect(inbox).toHaveLength(2);
    expect(inbox.some((row) => row.title.includes('askısı kaldırıldı'))).toBe(true);
  });

  /**
   * A dismissal notifies nobody. Telling the reported user hands them a grievance
   * and, on a small graph, a very short list of who must have filed it; telling the
   * reporter turns the report button into a scoreboard.
   */
  it('says nothing to anyone when a report is dismissed', async () => {
    const report = await prisma.report.create({
      data: { reporterId: bobId, postId: alicePostId, reportedUserId: aliceId, reason: 'SPAM' },
    });
    await moderation.dismiss({ reportId: report.id, moderatorId: modId, note: 'Kural ihlali yok.' });

    expect(await inboxOf(aliceId)).toHaveLength(0);
    expect(await inboxOf(bobId)).toHaveLength(0);
  });

  /**
   * THE INVERSE OF EVERY OTHER TEST IN THIS FILE. Elsewhere a failed notification
   * must not roll back the action; here the sanction and the notice are one
   * transaction, so a failure must leave neither. A suspension the user was never
   * told about is an account that stopped working for reasons they cannot appeal.
   */
  it('writes the sanction and the notice atomically — neither lands without the other', async () => {
    await expect(
      moderation.hidePost({
        postId: alicePostId,
        moderatorId: modId,
        reason: REASON,
        // Forces the report-resolution write in the same transaction to fail.
        reportId: 'does-not-exist',
      }),
    ).rejects.toThrow();

    const post = await prisma.post.findUniqueOrThrow({ where: { id: alicePostId } });
    expect(post.hiddenAt).toBeNull();
    expect(await inboxOf(aliceId)).toHaveLength(0);
    const actions = await prisma.moderationAction.findMany({ where: { subjectPostId: alicePostId } });
    expect(actions).toHaveLength(0);
  });

  /**
   * A block is between two users; it is not a way to opt out of being moderated.
   * Moderation notices carry no actor precisely so no block can intercept them.
   */
  it('delivers a moderation notice even to a user who has blocked everyone', async () => {
    await prisma.block.create({ data: { blockerId: aliceId, blockedId: modId } });
    await prisma.block.create({ data: { blockerId: aliceId, blockedId: bobId } });

    await moderation.warnUser(aliceId, modId, REASON);

    expect(await inboxOf(aliceId)).toHaveLength(1);
  });
});
