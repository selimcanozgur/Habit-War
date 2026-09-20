/**
 * Moderator tooling.
 *
 * Reports were already being collected; nothing could act on them. App Store
 * Guideline 1.2 and the DSA are both assessed on the *response* to a report, not on
 * the existence of a report button, so a queue with no way to work it is a queue
 * that fails review.
 *
 * Three principles the code enforces rather than documents:
 *
 *  1. Every action writes a ModerationAction row before the state change lands, in
 *     the same transaction. A hidden post with no record of who hid it or why cannot
 *     be defended when the author appeals.
 *  2. Dismissal is an action. "We looked and found nothing" is a response, and the
 *     response-time metric is meaningless if the fast cases go unrecorded.
 *  3. Nothing here hard-deletes. Hiding is reversible and suspension expires, so a
 *     mistaken call is recoverable — which is what makes it safe for one person to
 *     work the queue quickly.
 */

import type { ModerationActionType, Prisma, PrismaClient, ReportStatus } from '@prisma/client';

import { conflict, notFound, unprocessable } from '../../lib/errors.js';

/** Injectable clock, matching the convention across the other services. */
export type Clock = () => Date;

export interface ModerationServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

/**
 * Longest suspension this API will issue in one call.
 *
 * A permanent ban is expressed as a repeated or escalated suspension rather than an
 * unbounded date, so that every enforcement decision has a review point. One year is
 * long enough to be a real sanction and short enough that nobody is banned forever
 * by a single mis-click.
 */
export const MAX_SUSPENSION_DAYS = 365;

const DEFAULT_QUEUE_LIMIT = 25;
const MAX_QUEUE_LIMIT = 100;

/** Summary shown next to a report so the moderator has context before deciding. */
const REPORTER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export interface QueueOptions {
  readonly status?: ReportStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface ResolveReportInput {
  readonly reportId: string;
  readonly moderatorId: string;
  readonly note: string;
}

export interface HidePostInput {
  readonly postId: string;
  readonly moderatorId: string;
  readonly reason: string;
  readonly reportId?: string | undefined;
}

export interface SuspendUserInput {
  readonly userId: string;
  readonly moderatorId: string;
  readonly reason: string;
  readonly days: number;
  readonly reportId?: string | undefined;
}

export class ModerationService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: ModerationServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /**
   * The queue, oldest first.
   *
   * Oldest-first is deliberate and is the opposite of most list endpoints: the metric
   * that matters is how long the worst-served report has waited, and newest-first
   * lets old reports sink out of sight forever.
   */
  async queue(options: QueueOptions = {}): Promise<{
    reports: unknown[];
    nextCursor: string | null;
    counts: Record<string, number>;
  }> {
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_QUEUE_LIMIT), MAX_QUEUE_LIMIT);
    const decoded = options.cursor ? decodeCursor(options.cursor) : null;

    const rows = await this.#prisma.report.findMany({
      where: {
        ...(options.status ? { status: options.status } : {}),
        ...(decoded
          ? {
              OR: [
                { createdAt: { gt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { gt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: {
        reporter: { select: REPORTER_SELECT },
        reportedUser: { select: REPORTER_SELECT },
        reviewer: { select: REPORTER_SELECT },
        post: {
          select: {
            id: true,
            type: true,
            content: true,
            imageUrl: true,
            hiddenAt: true,
            createdAt: true,
            author: { select: REPORTER_SELECT },
          },
        },
      },
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null;

    const grouped = await this.#prisma.report.groupBy({ by: ['status'], _count: true });
    const counts: Record<string, number> = {};
    for (const entry of grouped) counts[entry.status] = entry._count;

    return { reports: page, nextCursor, counts };
  }

  /** Full history of what was done to one account. The appeal view. */
  async userHistory(userId: string): Promise<{ actions: unknown[]; reportsAgainst: number }> {
    const [actions, reportsAgainst] = await Promise.all([
      this.#prisma.moderationAction.findMany({
        where: { subjectUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: REPORTER_SELECT } },
      }),
      this.#prisma.report.count({ where: { reportedUserId: userId } }),
    ]);
    return { actions, reportsAgainst };
  }

  /**
   * Claims a report for review.
   *
   * Exists so two moderators do not work the same report twice. It is advisory —
   * a single-person team will rarely need it — but the transition is what makes the
   * "time to first response" metric measurable.
   */
  async claim(reportId: string, moderatorId: string): Promise<unknown> {
    const report = await this.#requireReport(reportId);
    if (report.status !== 'PENDING') {
      throw conflict(`Report is already ${report.status.toLowerCase()}`, {
        status: report.status,
        reviewerId: report.reviewerId,
      });
    }

    return this.#prisma.report.update({
      where: { id: reportId },
      data: { status: 'UNDER_REVIEW', reviewerId: moderatorId, reviewedAt: this.#now() },
    });
  }

  /**
   * Closes a report without acting on the content.
   *
   * Recorded as a ModerationAction, not just a status flip — see the module note.
   */
  async dismiss({ reportId, moderatorId, note }: ResolveReportInput): Promise<unknown> {
    const report = await this.#requireReport(reportId);
    this.#assertOpen(report.status);

    const at = this.#now();
    const [updated] = await this.#prisma.$transaction([
      this.#prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'DISMISSED',
          reviewerId: moderatorId,
          reviewedAt: at,
          resolutionNote: note,
        },
      }),
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'REPORT_DISMISSED',
          subjectUserId: report.reportedUserId,
          subjectPostId: report.postId,
          reportId,
          reason: note,
          createdAt: at,
        },
      }),
    ]);
    return updated;
  }

  /**
   * Hides a post from every reader but its author.
   *
   * Hidden rather than deleted: the author can still see their own post, which makes
   * the enforcement visible to the person it affects instead of leaving them to
   * discover it by accident, and the row survives for the appeal.
   */
  async hidePost({ postId, moderatorId, reason, reportId }: HidePostInput): Promise<unknown> {
    const post = await this.#prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, hiddenAt: true },
    });
    if (!post) throw notFound('Post not found');
    if (post.hiddenAt) throw conflict('Post is already hidden');

    const at = this.#now();
    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.#prisma.post.update({
        where: { id: postId },
        data: { hiddenAt: at, hiddenReason: reason },
      }),
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'POST_HIDDEN',
          subjectUserId: post.authorId,
          subjectPostId: postId,
          reportId: reportId ?? null,
          reason,
          createdAt: at,
        },
      }),
    ];

    if (reportId) writes.push(this.#resolveWrite(reportId, moderatorId, reason, at));

    const [updated] = await this.#prisma.$transaction(writes);
    return updated;
  }

  /** Reverses a hide. A separate action row, never an edit of the original. */
  async restorePost(postId: string, moderatorId: string, reason: string): Promise<unknown> {
    const post = await this.#prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, hiddenAt: true },
    });
    if (!post) throw notFound('Post not found');
    if (!post.hiddenAt) throw conflict('Post is not hidden');

    const at = this.#now();
    const [updated] = await this.#prisma.$transaction([
      this.#prisma.post.update({
        where: { id: postId },
        data: { hiddenAt: null, hiddenReason: null },
      }),
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'POST_RESTORED',
          subjectUserId: post.authorId,
          subjectPostId: postId,
          reason,
          createdAt: at,
        },
      }),
    ]);
    return updated;
  }

  /**
   * Suspends an account for a bounded period.
   *
   * Staff cannot be suspended through this route. A compromised moderator account
   * being used to disable the rest of the moderation team is a small hole with a very
   * bad shape, and staff sanctions should go through a human process anyway.
   */
  async suspendUser({
    userId,
    moderatorId,
    reason,
    days,
    reportId,
  }: SuspendUserInput): Promise<unknown> {
    if (userId === moderatorId) throw unprocessable('Moderators cannot suspend themselves');
    if (days < 1 || days > MAX_SUSPENSION_DAYS) {
      throw unprocessable(`Suspension must be between 1 and ${MAX_SUSPENSION_DAYS} days`);
    }

    const target = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!target) throw notFound('User not found');
    if (target.role !== 'USER') {
      throw unprocessable('Staff accounts cannot be suspended through this endpoint');
    }

    const at = this.#now();
    const until = new Date(at.getTime() + days * 86_400_000);

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.#prisma.user.update({
        where: { id: userId },
        data: { suspendedUntil: until, suspensionReason: reason },
      }),
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'USER_SUSPENDED',
          subjectUserId: userId,
          reportId: reportId ?? null,
          reason,
          expiresAt: until,
          createdAt: at,
        },
      }),
    ];

    if (reportId) writes.push(this.#resolveWrite(reportId, moderatorId, reason, at));

    await this.#prisma.$transaction(writes);
    return { userId, suspendedUntil: until, reason };
  }

  /** Lifts a suspension early. */
  async reinstateUser(userId: string, moderatorId: string, reason: string): Promise<unknown> {
    const target = await this.#prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, suspendedUntil: true },
    });
    if (!target) throw notFound('User not found');
    if (!target.suspendedUntil) throw conflict('User is not suspended');

    const at = this.#now();
    await this.#prisma.$transaction([
      this.#prisma.user.update({
        where: { id: userId },
        data: { suspendedUntil: null, suspensionReason: null },
      }),
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'USER_REINSTATED',
          subjectUserId: userId,
          reason,
          createdAt: at,
        },
      }),
    ]);
    return { userId, suspendedUntil: null };
  }

  /**
   * Records a warning.
   *
   * No state change, only a row — but a documented warning is what makes a later
   * suspension defensible as escalation rather than a first-strike surprise.
   */
  async warnUser(
    userId: string,
    moderatorId: string,
    reason: string,
    reportId?: string,
  ): Promise<unknown> {
    const target = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw notFound('User not found');

    const at = this.#now();
    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.#prisma.moderationAction.create({
        data: {
          actorId: moderatorId,
          action: 'USER_WARNED' satisfies ModerationActionType,
          subjectUserId: userId,
          reportId: reportId ?? null,
          reason,
          createdAt: at,
        },
      }),
    ];
    if (reportId) writes.push(this.#resolveWrite(reportId, moderatorId, reason, at));

    const [action] = await this.#prisma.$transaction(writes);
    return action;
  }

  /** Marks a report resolved as part of an enforcement transaction. */
  #resolveWrite(
    reportId: string,
    moderatorId: string,
    note: string,
    at: Date,
  ): Prisma.PrismaPromise<unknown> {
    return this.#prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'ACTION_TAKEN',
        reviewerId: moderatorId,
        reviewedAt: at,
        resolutionNote: note,
      },
    });
  }

  async #requireReport(reportId: string): Promise<{
    id: string;
    status: ReportStatus;
    reviewerId: string | null;
    postId: string | null;
    reportedUserId: string | null;
  }> {
    const report = await this.#prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        status: true,
        reviewerId: true,
        postId: true,
        reportedUserId: true,
      },
    });
    if (!report) throw notFound('Report not found');
    return report;
  }

  #assertOpen(status: ReportStatus): void {
    if (status === 'ACTION_TAKEN' || status === 'DISMISSED') {
      throw conflict(`Report is already resolved (${status.toLowerCase()})`);
    }
  }
}

/** Ascending cursor — the queue runs oldest first, so the comparison is `>`. */
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
    return null;
  }
}
