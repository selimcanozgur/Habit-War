/**
 * Notifications.
 *
 * Two halves that must not be confused:
 *
 *  - The in-app inbox (`Notification` rows) is the record. It is written
 *    synchronously with the event that caused it, inside the same transaction where
 *    that matters, so the inbox can never disagree with what actually happened.
 *
 *  - Push delivery is best-effort and lives outside that transaction. A failed push
 *    must never roll back a like, a friend request or an XP award.
 *
 * The spec promised push notifications as a Phase 1 deliverable but defined no
 * device-token storage, no notification list and no preferences — the audit
 * confirmed all three were missing. This module covers the first two; preferences
 * are deliberately left for the settings work (see `remaining` note at the bottom).
 */

import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';

import { notFound } from '../../lib/errors.js';
import { SafetyService } from '../safety/service.js';

/** Injectable clock, matching the convention in SessionService. */
export type Clock = () => Date;

/**
 * Where a swallowed notification failure goes.
 *
 * `create` is called from inside other people's write paths, and a failure there must
 * not roll back the like or the friend request that caused it (see `createSafely`).
 * "Must not roll back" is not the same as "must be invisible", though: a notification
 * table that has quietly stopped being written to is exactly the kind of outage
 * nobody notices for a month. Routes may pass `app.log.error`; the default writes to
 * stderr so the failure is at least on the record.
 */
export type NotificationErrorSink = (error: unknown, input: CreateNotificationInput) => void;

export interface NotificationServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /** Overrides where `createSafely` reports a swallowed failure. */
  readonly onError?: NotificationErrorSink | undefined;
}

export interface CreateNotificationInput {
  /** Who receives it. */
  readonly userId: string;
  /** Who caused it. Null for system notifications (season start, moderation). */
  readonly actorId?: string | null;
  readonly type: NotificationType;
  readonly title: string;
  readonly body?: string | null;
  readonly targetType?: 'POST' | 'USER' | 'CHALLENGE' | 'ACHIEVEMENT' | 'SEASON' | null;
  readonly targetId?: string | null;
}

/**
 * The spec's own risk table caps notifications at three per day, and the audit found
 * the feature set generates far more demand than that. The cap is not enforced here
 * — that belongs to the delivery path, which can see the whole day — but the constant
 * lives with the code that will need it. `push.ts` is what enforces it; see
 * `isSubjectToDailyLimit` there for which types the cap binds and why.
 */
export const DAILY_PUSH_LIMIT = 3;

/** Inbox page size. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export class NotificationService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;
  readonly #safety: SafetyService;
  readonly #onError: NotificationErrorSink;

  constructor({ prisma, now, onError }: NotificationServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    // Blocks are enforced here rather than re-implemented per caller; SafetyService
    // owns the rule and is the only place it is written down.
    this.#safety = new SafetyService({ prisma, now });
    this.#onError =
      onError ??
      ((error, input) => {
        // eslint-disable-next-line no-console -- last-resort sink; see NotificationErrorSink.
        console.error('[notifications] failed to record notification', input.type, error);
      });
  }

  /**
   * Records a notification.
   *
   * Three guards, all of them here rather than at the call sites, because a guard
   * that has to be repeated eight times is a guard that will be missing from the
   * ninth:
   *
   *  1. SELF. Self-notifications are dropped rather than rejected: liking your own
   *     post is legal, it just should not ping you.
   *  2. DELETED RECIPIENT. A KVKK-erased account is not notified.
   *  3. BLOCKS, IN BOTH DIRECTIONS. A notification is content from one user to
   *     another, so it is subject to the same rule as the feed: if either party has
   *     blocked the other, nothing arrives. Leaving this out would make the inbox the
   *     one surface a blocked user can still reach — "X liked your post" from someone
   *     you blocked is exactly the contact the block exists to end, and it also
   *     re-exposes their handle and avatar through the actor join in `list`.
   *     `SafetyService.isBlockedEitherWay` is the pairwise form of `blockedUserIds`,
   *     the helper every other module filters on; the pairwise form is used because a
   *     notification has exactly one actor, and loading the recipient's entire block
   *     set to answer a one-row question turns every like into a scan.
   *
   * System notifications (`actorId` null — moderation, seasons) skip 1 and 3 by
   * construction: there is no actor to be blocked, and a user must not be able to
   * block their way out of a suspension notice.
   */
  async create(input: CreateNotificationInput): Promise<void> {
    if (input.actorId && input.actorId === input.userId) return;

    const recipient = await this.#prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!recipient) return; // Deleted account: nothing to notify.

    if (input.actorId && (await this.#safety.isBlockedEitherWay(input.userId, input.actorId))) {
      return;
    }

    await this.#prisma.notification.create({ data: this.#toRow(input) });
  }

  /**
   * `create`, with failures swallowed.
   *
   * THIS IS THE FORM EVERY SOCIAL CALL SITE USES. The notification is a consequence
   * of the like, the follow or the duel invitation — never a precondition of it. If
   * the notification write fails, the like must still stand: rolling back a user's
   * action because we could not tell someone else about it inverts the importance of
   * the two writes, and the user would see their like disappear for a reason that has
   * nothing to do with them.
   *
   * Moderation deliberately does NOT use this; see `modules/moderation/service.ts`,
   * where the notice is written inside the enforcement transaction instead.
   */
  async createSafely(input: CreateNotificationInput): Promise<void> {
    try {
      await this.create(input);
    } catch (error) {
      this.#onError(error, input);
    }
  }

  /**
   * The display name to put in notification copy.
   *
   * Needed because the copy is rendered at write time (see `copy.ts`) and most call
   * sites only hold the actor's id — they acted as the actor, so they never had to
   * load their own profile. One indexed primary-key read on a path that already does
   * several is an acceptable price for a lock-screen line that says who did the thing.
   *
   * The fallback is deliberate rather than a throw: a missing profile must not be
   * able to fail the action the notification is about.
   */
  async actorDisplayName(userId: string): Promise<string> {
    const user = await this.#prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? 'Bir kullanıcı';
  }

  /**
   * Builds the row without writing it, so a caller can include the notification in
   * its own `$transaction` array. Used where the notification must not survive a
   * rolled-back action.
   */
  buildRow(input: CreateNotificationInput): Prisma.NotificationCreateInput {
    return this.#toRow(input) as unknown as Prisma.NotificationCreateInput;
  }

  #toRow(input: CreateNotificationInput): Prisma.NotificationUncheckedCreateInput {
    return {
      userId: input.userId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      createdAt: this.#now(),
    };
  }

  /** Inbox, newest first, cursor-paginated on (createdAt, id) like the feed. */
  async list(
    userId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Promise<{ notifications: unknown[]; nextCursor: string | null; unreadCount: number }> {
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const decoded = options.cursor ? decodeCursor(options.cursor) : null;

    const rows = await this.#prisma.notification.findMany({
      where: {
        userId,
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null;

    const unreadCount = await this.#prisma.notification.count({
      where: { userId, readAt: null },
    });

    return { notifications: page, nextCursor, unreadCount };
  }

  /** Marks one notification read. Idempotent. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    const existing = await this.#prisma.notification.findFirst({
      where: { id: notificationId, userId },
      select: { id: true, readAt: true },
    });
    if (!existing) throw notFound('Notification not found');
    if (existing.readAt) return;

    await this.#prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: this.#now() },
    });
  }

  /** Marks the whole inbox read. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.#prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: this.#now() },
    });
    return { updated: result.count };
  }

  /**
   * Registers an Expo push token.
   *
   * The token is globally unique: a device signing into a second account must MOVE
   * the token, not duplicate it, or the previous owner keeps receiving the new
   * owner's notifications. The upsert below is what performs that move.
   */
  async registerPushToken(input: {
    userId: string;
    token: string;
    platform: 'IOS' | 'ANDROID' | 'WEB';
    deviceId?: string | undefined;
  }): Promise<void> {
    await this.#prisma.pushToken.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
      },
      update: {
        userId: input.userId,
        platform: input.platform,
        deviceId: input.deviceId ?? null,
        disabledAt: null, // A re-register revives a token Expo had reported dead.
      },
    });
  }

  /** Removes a push token, e.g. on sign-out. Idempotent. */
  async removePushToken(userId: string, token: string): Promise<void> {
    await this.#prisma.pushToken.deleteMany({ where: { token, userId } });
  }
}

/**
 * Cursor encoding.
 *
 * Composite (createdAt, id) rather than createdAt alone: two notifications written in
 * the same millisecond would otherwise be skipped or repeated across pages.
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    // A malformed cursor means the client sent something we never issued. Treating
    // it as "start from the beginning" is friendlier than a 400 and leaks nothing.
    return null;
  }
}
