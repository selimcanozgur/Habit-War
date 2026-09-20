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

/** Injectable clock, matching the convention in SessionService. */
export type Clock = () => Date;

export interface NotificationServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
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
 * — that belongs to the delivery job, which can see the whole day — but the constant
 * lives with the code that will need it.
 */
export const DAILY_PUSH_LIMIT = 3;

/** Inbox page size. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export class NotificationService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: NotificationServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /**
   * Records a notification.
   *
   * Self-notifications are dropped rather than rejected: liking your own post is
   * legal, it just should not ping you. Callers would otherwise all need the same
   * guard, and one of them would forget.
   */
  async create(input: CreateNotificationInput): Promise<void> {
    if (input.actorId && input.actorId === input.userId) return;

    const recipient = await this.#prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!recipient) return; // Deleted account: nothing to notify.

    await this.#prisma.notification.create({ data: this.#toRow(input) });
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
