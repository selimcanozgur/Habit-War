/**
 * Account erasure — the hard delete that finishes a KVKK art. 7 request.
 *
 * `DELETE /v1/me` soft-deletes and promises the user a `purgeEligibleAt` date; this
 * job keeps that promise. Everything a user has — books, logs, ledger, tokens — is
 * their own data and goes with the row through the schema's cascades.
 *
 * IDEMPOTENT. The candidate query selects only rows that still exist and are still
 * past the retention window, so a retry after a partial run simply finds fewer rows.
 * Each account is purged in its own statement: a crash mid-batch leaves every
 * already-purged account purged and every other one untouched.
 */

import { ACCOUNT_ERASURE_BATCH_SIZE, ACCOUNT_ERASURE_RETENTION_DAYS, MS_PER_DAY } from '../constants.js';
import type { JobContext, JobOutcome } from '../context.js';

export interface AccountErasureResult extends JobOutcome {
  /** Accounts hard-deleted by this run. */
  readonly processed: number;
  /** Accounts past the retention window right now, batch size ignored — the backlog. */
  readonly eligible: number;
}

/**
 * The instant a soft delete must predate to be purgeable. The window is a parameter
 * so a test can exercise the boundary without waiting 30 days.
 */
export function erasureCutoff(now: Date, retentionDays = ACCOUNT_ERASURE_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

/** Purges up to `ACCOUNT_ERASURE_BATCH_SIZE` expired accounts, oldest request first. */
export async function runAccountErasure(context: JobContext): Promise<AccountErasureResult> {
  const { prisma, now, logger } = context;
  const cutoff = erasureCutoff(now);
  const where = { deletedAt: { not: null, lte: cutoff } } as const;

  const eligible = await prisma.user.count({ where });
  const candidates = await prisma.user.findMany({
    where,
    orderBy: { deletedAt: 'asc' },
    take: ACCOUNT_ERASURE_BATCH_SIZE,
    select: { id: true },
  });

  let processed = 0;
  for (const candidate of candidates) {
    // Re-checks the window in the delete itself: the row may have been purged by an
    // earlier attempt of this same job since the candidate query ran.
    const deleted = await prisma.user.deleteMany({ where: { id: candidate.id, ...where } });
    processed += deleted.count;
  }

  logger.info(
    {
      purged: processed,
      eligible,
      remaining: Math.max(0, eligible - processed),
      cutoff: cutoff.toISOString(),
    },
    'account erasure finished',
  );

  return { processed, eligible };
}
