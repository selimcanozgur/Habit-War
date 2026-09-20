/**
 * Stale session sweep — abandons timers the user walked away from.
 *
 * `SessionService` closes a user's own stale sessions on the request path, inside
 * `start` and the active-session read. That covers the user who comes back; it does
 * nothing for the user who does not. A session left ACTIVE is not merely untidy: the
 * single-active-session rule means the user's NEXT session is rejected with a 409
 * until something closes this one, so the forgotten timer locks them out of the
 * product until they happen to hit a path that sweeps. It also keeps a row in the
 * `@@index([status, startedAt])` working set that nothing will ever resolve.
 *
 * The cutoff is `MAX_SESSION_MINUTES` — imported, never redefined. It is the same
 * boundary the XP engine uses to decide what is creditable, so a session past it has
 * already stopped being able to earn anything. Abandoning it destroys no value.
 *
 * IDEMPOTENT by construction: the filter selects `status: 'ACTIVE'` and the write
 * leaves `ABANDONED`, so a second run matches nothing. One `updateMany`, no loop,
 * no transaction — the whole job is a single statement whose `count` is the answer.
 */

import { MAX_SESSION_MINUTES } from '@habitwar/domain';

import type { JobContext, JobOutcome } from '../context.js';

export interface StaleSessionSweepResult extends JobOutcome {
  /** Sessions moved from ACTIVE to ABANDONED. */
  readonly processed: number;
  readonly cutoff: Date;
}

/**
 * The instant a session must have started before to count as abandoned. Pure.
 *
 * Deliberately the same arithmetic as `SessionService.#closeStaleSessions`, which is
 * private and cannot be imported. If that boundary ever changes, both sides read
 * `MAX_SESSION_MINUTES`, so they change together — the duplicated line is the
 * subtraction, not the rule.
 */
export function staleSessionCutoff(now: Date): Date {
  return new Date(now.getTime() - MAX_SESSION_MINUTES * 60_000);
}

export async function runStaleSessionSweep(
  context: JobContext,
): Promise<StaleSessionSweepResult> {
  const { prisma, now, logger } = context;
  const cutoff = staleSessionCutoff(now);

  const result = await prisma.session.updateMany({
    where: { status: 'ACTIVE', startedAt: { lt: cutoff } },
    // `endedAt: now` rather than `startedAt + MAX_SESSION_MINUTES`, matching what the
    // request path writes. The honest reading of the column is "when we stopped
    // counting this session", and two paths that close the same kind of row must not
    // stamp it with two different meanings. Nothing is credited either way:
    // `durationSec` stays null, so an abandoned session can never be scored.
    data: { status: 'ABANDONED', endedAt: now },
  });

  logger.info(
    { abandoned: result.count, cutoff: cutoff.toISOString() },
    'stale session sweep finished',
  );

  return { processed: result.count, cutoff };
}
