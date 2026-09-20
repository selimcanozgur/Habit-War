/**
 * Account erasure — the hard delete that finishes a KVKK art. 7 request.
 *
 * `SafetyService.requestAccountDeletion` soft-deletes and promises the user a
 * `purgeEligibleAt` date. Until this job existed, nothing ever consumed that promise:
 * erasure was effective (the account is unreachable and cannot authenticate) but not
 * completed, and the personal data was still sitting in the table. This is the other
 * half.
 *
 * IDEMPOTENT. The candidate query selects only rows that still exist and are still
 * past the retention window, so a retry after a partial run simply finds fewer rows.
 * Each account is purged in its OWN transaction: a crash mid-batch leaves every
 * already-purged account purged and every other one untouched, which is the only
 * failure mode that does not need a human to reconcile afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CASCADE TAKES (verified against prisma/schema.prisma, all `onDelete`)
 * ---------------------------------------------------------------------------
 * Deleted with the user (Cascade, i.e. their own data — correct to destroy):
 *   Habit, Session, XpLedger, DailyUsage, Post (as author, incl. their comments),
 *   PostLike, Notification (as recipient), PushToken, UserAchievement,
 *   Friendship (both directions), Follow (both directions), Block (both directions),
 *   ConsentRecord.
 *
 * Survives automatically (SetNull — the schema already protects other people's rows):
 *   Notification.actorId      → recipient keeps the notification, it degrades to "someone"
 *   Challenge.winnerId        → a settled duel keeps its result
 *   Report.reviewerId         → a departed moderator does not erase their decisions
 *   Report.postId             → a report outlives the post it was filed against
 *   ModerationAction.actorId  → the moderator's own actions stay attributable-by-absence
 *   ModerationAction.subjectPostId, .reportId
 *   Post.sessionId / .userAchievementId / .challengeId / .parentId
 *
 * Would be destroyed by Cascade although it is NOT the purged user's to destroy —
 * these are the two this job anonymises BEFORE deleting:
 *   Report.reportedUserId      (Cascade) → somebody else's report about this account.
 *                              The report is the reporter's record and the evidence
 *                              that the moderation SLA was met; it must not vanish
 *                              because the accused deleted their account. Nulled.
 *   ModerationAction.subjectUserId (Cascade) → the append-only enforcement trail the
 *                              schema says is "never updated or deleted". Store
 *                              reviews and regulators ask what was done and when;
 *                              an account deletion must not be a way to launder it.
 *                              Nulled.
 *
 * Accepted collateral, documented rather than worked around:
 *   Report.reporterId is Cascade AND non-nullable, so reports this user FILED are
 *   deleted. That is the defensible side of the trade: the report's free-text
 *   `details` is the purged user's own writing about themselves and others, and
 *   keeping it would mean keeping personal data after an erasure request. The
 *   ModerationAction rows that responded to those reports survive (reportId is
 *   SetNull), so the record of what moderators DID remains complete.
 *
 *   Challenge is Cascade on both challengerId and opponentId, both non-nullable, so
 *   purging one duellist removes the duel from the opponent's history too. The
 *   opponent's CHALLENGE_RESULT feed post survives (Post.challengeId is SetNull).
 *   Fixing this properly needs nullable participants, which is a migration, and this
 *   job is explicitly not allowed to change the schema.
 *
 * DENORMALISED COUNTERS. `Post.likeCount` and `Post.commentCount` count rows the
 * cascade is about to delete, and the database will not adjust them. Left alone, a
 * purge silently inflates every counter on every post the user ever liked or replied
 * to — a post reading "12 beğeni" with 11 likes, forever. Both are corrected inside
 * the same transaction as the delete, because a counter observed out of step with the
 * rows it counts is the exact bug the feed service's own comment warns about.
 */

import type { Prisma } from '@prisma/client';

import { ACCOUNT_ERASURE_RETENTION_DAYS } from '../../modules/safety/service.js';
import { ACCOUNT_ERASURE_BATCH_SIZE, MS_PER_DAY } from '../constants.js';
import type { JobContext, JobOutcome } from '../context.js';

export interface AccountErasureResult extends JobOutcome {
  /** Accounts hard-deleted by this run. */
  readonly processed: number;
  /** Accounts past the retention window right now, batch size ignored — the backlog. */
  readonly eligible: number;
  readonly reportsAnonymised: number;
  readonly moderationActionsAnonymised: number;
  readonly likeCountersRepaired: number;
  readonly commentCountersRepaired: number;
  /** Rows that disappeared between the candidate query and the transaction. */
  readonly vanished: number;
}

/**
 * The instant a soft delete must predate to be purgeable.
 *
 * Pure, and exported so a test can state the boundary without reaching for the
 * database. The retention window is a parameter with a default rather than a
 * hard-coded read, so a test can exercise the boundary without waiting 30 days —
 * production always passes nothing and therefore always uses the constant the API
 * already promised the user.
 */
export function erasureCutoff(now: Date, retentionDays = ACCOUNT_ERASURE_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

interface PurgeCounts {
  readonly reportsAnonymised: number;
  readonly moderationActionsAnonymised: number;
  readonly likeCountersRepaired: number;
  readonly commentCountersRepaired: number;
}

/**
 * Anonymises what must outlive the account, repairs the counters the cascade is about
 * to falsify, then deletes the user and lets the database cascade.
 *
 * Returns null when the row is no longer eligible — already purged, or undeleted
 * between the candidate query and this transaction. Returning rather than throwing
 * keeps a lost race a no-op instead of a failed run.
 */
export async function purgeAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  cutoff: Date,
): Promise<PurgeCounts | null> {
  // Re-checked inside the transaction, not trusted from the candidate query: between
  // the two, a user may have been purged by a previous attempt of this same job.
  const target = await tx.user.findFirst({
    where: { id: userId, deletedAt: { not: null, lte: cutoff } },
    select: { id: true },
  });
  if (!target) return null;

  // --- Counter repair ------------------------------------------------------
  // Every like is one row per (post, user) — `@@unique([postId, userId])` — so each
  // affected post loses exactly one, which is why a single updateMany is exact here.
  // `likeCount: { gt: 0 }` guards against driving an already-wrong counter negative.
  const liked = await tx.postLike.findMany({ where: { userId }, select: { postId: true } });
  const likedPostIds = liked.map((row) => row.postId);
  const likeCounters =
    likedPostIds.length === 0
      ? { count: 0 }
      : await tx.post.updateMany({
          where: { id: { in: likedPostIds }, likeCount: { gt: 0 } },
          data: { likeCount: { decrement: 1 } },
        });

  // Comments are counted per parent, and only while not soft-deleted: the feed
  // service already decremented the parent when the author deleted a reply, so
  // counting those again would take the parent's counter below the truth.
  const commentGroups = await tx.post.groupBy({
    by: ['parentId'],
    where: { authorId: userId, parentId: { not: null }, deletedAt: null },
    _count: { _all: true },
  });

  let commentCountersRepaired = 0;
  for (const group of commentGroups) {
    const parentId = group.parentId;
    if (parentId === null) continue;
    const amount = group._count._all;
    // `gte: amount` is the same non-negative guard as above, expressed as a filter so
    // the whole decrement is one statement.
    const updated = await tx.post.updateMany({
      where: { id: parentId, commentCount: { gte: amount } },
      data: { commentCount: { decrement: amount } },
    });
    commentCountersRepaired += updated.count;
  }

  // --- Anonymisation -------------------------------------------------------
  // After this the report has neither a post nor a reported user. That is deliberate:
  // the XOR `createReport` enforces is a WRITE-path invariant, and this row is no
  // longer writable by anyone. What it still carries is what it is kept for — the
  // reporter, the reason, the moderator's decision and the timestamps the response
  // SLA is measured on.
  const reports = await tx.report.updateMany({
    where: { reportedUserId: userId },
    data: { reportedUserId: null },
  });

  const actions = await tx.moderationAction.updateMany({
    where: { subjectUserId: userId },
    data: { subjectUserId: null },
  });

  // Throws P2025 if the row lost a race with a concurrent purge, which rolls this
  // whole transaction back — counters and anonymisation included. That is the correct
  // outcome: the other transaction did the same work, and the retry finds nothing.
  await tx.user.delete({ where: { id: userId } });

  return {
    reportsAnonymised: reports.count,
    moderationActionsAnonymised: actions.count,
    likeCountersRepaired: likeCounters.count,
    commentCountersRepaired,
  };
}

/** Purges up to `ACCOUNT_ERASURE_BATCH_SIZE` expired accounts, oldest request first. */
export async function runAccountErasure(context: JobContext): Promise<AccountErasureResult> {
  const { prisma, now, logger } = context;
  const cutoff = erasureCutoff(now);
  const where = { deletedAt: { not: null, lte: cutoff } } as const;

  // Counted separately from the batch so the log line can show the backlog. A purge
  // that clears 50 of 3,000 every night is not visible from "purged: 50" alone.
  const eligible = await prisma.user.count({ where });

  const candidates = await prisma.user.findMany({
    where,
    // Oldest erasure request first: the longest-waiting user is the one whose
    // retention window is furthest past its promise.
    orderBy: { deletedAt: 'asc' },
    take: ACCOUNT_ERASURE_BATCH_SIZE,
    select: { id: true },
  });

  let processed = 0;
  let vanished = 0;
  let reportsAnonymised = 0;
  let moderationActionsAnonymised = 0;
  let likeCountersRepaired = 0;
  let commentCountersRepaired = 0;

  for (const candidate of candidates) {
    const counts = await prisma.$transaction((tx) => purgeAccount(tx, candidate.id, cutoff));
    if (counts === null) {
      vanished += 1;
      continue;
    }
    processed += 1;
    reportsAnonymised += counts.reportsAnonymised;
    moderationActionsAnonymised += counts.moderationActionsAnonymised;
    likeCountersRepaired += counts.likeCountersRepaired;
    commentCountersRepaired += counts.commentCountersRepaired;
  }

  logger.info(
    {
      purged: processed,
      eligible,
      remaining: Math.max(0, eligible - processed),
      reportsAnonymised,
      moderationActionsAnonymised,
      likeCountersRepaired,
      commentCountersRepaired,
      vanished,
      cutoff: cutoff.toISOString(),
    },
    'account erasure finished',
  );

  return {
    processed,
    eligible,
    reportsAnonymised,
    moderationActionsAnonymised,
    likeCountersRepaired,
    commentCountersRepaired,
    vanished,
  };
}
