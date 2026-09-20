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
 *  4. THE SUBJECT IS TOLD. Every enforcement below writes a MODERATION_ACTION
 *     notification for the user it lands on, and it writes it INSIDE the same
 *     transaction as the sanction. See `#notifySubject` for why that is the one place
 *     in the codebase where a notification is not best-effort.
 */

import type { ModerationActionType, Prisma, PrismaClient, ReportStatus } from '@prisma/client';

import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { copy } from '../notifications/copy.js';
import { NotificationService } from '../notifications/service.js';

/** Injectable clock, matching the convention across the other services. */
export type Clock = () => Date;

export interface ModerationServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /**
   * Injectable so a test can assert on what was recorded without a second database
   * read. Defaults to a service over the same prisma/clock, so nothing else has to
   * change to wire it up.
   */
  readonly notifications?: NotificationService | undefined;
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
  readonly #notifications: NotificationService;

  constructor({ prisma, now, notifications }: ModerationServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    this.#notifications = notifications ?? new NotificationService({ prisma, now });
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
   *
   * THE ONLY PATH HERE THAT NOTIFIES NOBODY, and both silences are deliberate. The
   * reported user is not told, because nothing happened to them and "someone reported
   * you, we found nothing" hands them a grievance and, on a small graph, a very short
   * list of who it must have been. The reporter is not told either: a per-report
   * verdict turns the report button into a scoreboard and invites re-reporting until
   * the answer changes.
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
      // The author is the one person who can still see the post, so without this they
      // would see it sitting there looking published while nobody else can read it.
      this.#notifySubject(post.authorId, copy.postHidden(reason), { type: 'POST', id: postId }),
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
      // A reversal is owed as loudly as the sanction was. The author was told their
      // post broke the rules; leaving them to notice on their own that we changed our
      // mind keeps them believing a finding we have since withdrawn. The moderator's
      // `reason` for the restore is NOT forwarded — it is an internal note, and the
      // user only needs to know the restriction is gone.
      this.#notifySubject(post.authorId, copy.postRestored(), { type: 'POST', id: postId }),
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
      // `timezone` is selected for the notice: "12 Ekim'e kadar askıya alındı" has to
      // mean the suspended user's 12 October, not the server's. Same reasoning as the
      // day boundary for streaks and daily caps.
      select: { id: true, role: true, timezone: true },
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
      // The notice that matters most. A suspended account can still read its inbox
      // and export its data (see the route guard), which is exactly what makes
      // writing this row worth doing: it is the only channel left that reaches the
      // person, and it carries the end date the appeal is measured against.
      this.#notifySubject(userId, copy.userSuspended(until, reason, target.timezone), {
        type: 'USER',
        id: userId,
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
      // Without this the user has to keep trying the app to discover the lock is off,
      // and a reinstatement nobody hears about does not undo the harm of the days
      // they spent locked out believing the suspension still had weeks to run.
      this.#notifySubject(userId, copy.userReinstated(), { type: 'USER', id: userId }),
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
      // A warning that is only recorded is not a warning, it is a trap: the whole
      // argument for treating a later suspension as escalation rather than a
      // first-strike surprise is that the user was given a chance to correct course.
      // That chance only exists if they were told.
      this.#notifySubject(userId, copy.userWarned(reason), { type: 'USER', id: userId }),
    ];
    if (reportId) writes.push(this.#resolveWrite(reportId, moderatorId, reason, at));

    const [action] = await this.#prisma.$transaction(writes);
    return action;
  }

  /**
   * The notice that tells a user what was done to their account, as a write to be
   * included in the enforcement transaction.
   *
   * THIS IS THE ONE NOTIFICATION IN THE CODEBASE THAT IS NOT BEST-EFFORT, and the
   * difference is deliberate. Everywhere else a notification is a consequence of an
   * action the user took, so `createSafely` swallows a failure rather than rolling
   * back a like nobody should lose. Here the relationship is inverted: the sanction
   * is done TO the user, and a suspension they were never told about is not a
   * slightly degraded suspension — it is an account that stopped working for reasons
   * the person cannot see, cannot date and therefore cannot appeal. The DSA's
   * statement-of-reasons duty and KVKK's transparency principle both attach to the
   * telling, not to the enforcing. So the two either both land or neither does, and
   * a notification failure correctly fails the whole call: the moderator retries and
   * ends up with one sanction and one notice, which is the only consistent pair.
   *
   * `buildRow` rather than `create` is what makes that possible — it returns the row
   * without writing it, so the caller can put it in its own `$transaction` array.
   *
   * The actor is left NULL on purpose, matching the copy in `notifications/copy.ts`:
   * a user who learns which moderator sanctioned them has a target. They learn WHAT
   * happened, WHY and FOR HOW LONG, which is the whole of what an appeal needs.
   */
  #notifySubject(
    userId: string,
    text: { title: string; body: string | null },
    target: { type: 'POST' | 'USER'; id: string },
  ): Prisma.PrismaPromise<unknown> {
    return this.#prisma.notification.create({
      data: this.#notifications.buildRow({
        userId,
        actorId: null,
        type: 'MODERATION_ACTION',
        title: text.title,
        body: text.body,
        targetType: target.type,
        targetId: target.id,
      }),
    });
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
