/**
 * Duel settlement — closes duels whose clock has run out.
 *
 * `ChallengeService` settles expired duels LAZILY, when a participant opens the duel
 * screen, and says so in its own comment: "There is no scheduler in this phase". The
 * consequence is the one case that matters — both players lose interest, neither
 * opens the app, and the duel stays ACTIVE forever. Nobody is ever told who won, and
 * the pair is blocked from starting another duel, because `LIVE_STATUSES` counts
 * ACTIVE as live. `@@index([status, endsAt])` on Challenge exists for exactly this
 * query; until now nothing ran it.
 *
 * IDEMPOTENT, and safe to race against the lazy read path. The final write is an
 * `updateMany` filtered on `status: 'ACTIVE'`, so whichever of the two gets there
 * first settles the duel and the other's update matches zero rows. Notifications are
 * written INSIDE that same transaction, gated on the same row count, which is what
 * makes "settled" and "both players were told" a single fact rather than two that can
 * drift. A retry after a crash either redoes both or neither.
 *
 * SCORING IS NOT REIMPLEMENTED HERE. `ChallengeService.scoreFor` derives a side's
 * total from XpLedger with the flagged-session and category rules already applied;
 * a second copy of that query in a job is how a duel settled by a job would start
 * disagreeing with the same duel settled by a screen refresh.
 */

import type { Prisma } from '@prisma/client';

import { ChallengeService } from '../../modules/game/challenges.js';
import { copy, type DuelOutcome } from '../../modules/notifications/copy.js';
import { DUEL_SETTLEMENT_BATCH_SIZE } from '../constants.js';
import type { JobContext, JobOutcome } from '../context.js';

export interface DuelSettlementResult extends JobOutcome {
  /** Duels this run moved from ACTIVE to COMPLETED. */
  readonly processed: number;
  /** Expired duels found, before any of them were settled. */
  readonly expired: number;
  /** Settled by the lazy read path between our read and our write. */
  readonly alreadySettled: number;
  /** ACTIVE duels with no startsAt/endsAt — unscoreable, left alone and reported. */
  readonly malformed: number;
  readonly draws: number;
  readonly notificationsWritten: number;
}

/**
 * Who won, from two totals. Pure.
 *
 * A draw returns null, matching the schema's rule that `status` — not `winnerId` — is
 * the authority on whether a duel finished. The same three-way comparison lives in
 * `ChallengeService`; it is stated here as a named function so the tie case can be
 * tested directly, because a tie silently resolving to "the challenger wins" is the
 * kind of bug that only shows up in a leaderboard argument.
 */
export function decideDuelWinner(
  participants: { readonly challengerId: string; readonly opponentId: string },
  challengerXp: number,
  opponentXp: number,
): string | null {
  if (challengerXp > opponentXp) return participants.challengerId;
  if (opponentXp > challengerXp) return participants.opponentId;
  return null;
}

/** How the result reads from one participant's own side. Pure. */
export function duelOutcomeFor(userId: string, winnerId: string | null): DuelOutcome {
  if (winnerId === null) return 'DRAW';
  return winnerId === userId ? 'WON' : 'LOST';
}

/**
 * The result notification for one side, or null if it must not be written.
 *
 * Deleted recipients are skipped, mirroring guard 2 in `NotificationService.create`.
 * The other two guards there do not apply and are deliberately not re-implemented:
 * there is no actor to be self-notified or blocked, because `copy.challengeEnded` is
 * system copy that never names the opponent — precisely so a result can be delivered
 * after the other player has blocked, deleted or been purged.
 */
function resultNotification(
  participant: { readonly id: string; readonly deletedAt: Date | null },
  challengeId: string,
  winnerId: string | null,
  ownXp: number,
  opponentXp: number,
  now: Date,
): Prisma.NotificationCreateManyInput | null {
  if (participant.deletedAt !== null) return null;

  const outcome = duelOutcomeFor(participant.id, winnerId);
  const text = copy.challengeEnded(outcome, ownXp, opponentXp);

  return {
    userId: participant.id,
    actorId: null,
    type: 'CHALLENGE_ENDED',
    title: text.title,
    body: text.body,
    targetType: 'CHALLENGE',
    targetId: challengeId,
    createdAt: now,
  };
}

/** Settles up to `DUEL_SETTLEMENT_BATCH_SIZE` expired duels, longest-overdue first. */
export async function runDuelSettlement(context: JobContext): Promise<DuelSettlementResult> {
  const { prisma, now, logger } = context;

  const expired = await prisma.challenge.findMany({
    where: { status: 'ACTIVE', endsAt: { lte: now } },
    // Longest overdue first, so a backlog drains in the order players were let down.
    orderBy: { endsAt: 'asc' },
    take: DUEL_SETTLEMENT_BATCH_SIZE,
    include: {
      challenger: { select: { id: true, deletedAt: true } },
      opponent: { select: { id: true, deletedAt: true } },
    },
  });

  // The service takes a clock; the run's frozen instant is handed to it so the score
  // window and the `settledAt` written below cannot come from two different moments.
  const challenges = new ChallengeService({ prisma, now: () => now });

  let processed = 0;
  let alreadySettled = 0;
  let malformed = 0;
  let draws = 0;
  let notificationsWritten = 0;

  for (const challenge of expired) {
    const { startsAt, endsAt } = challenge;
    if (!startsAt || !endsAt) {
      // An ACTIVE duel without a clock cannot be scored over a window, and guessing
      // one would invent a result. Reported rather than silently skipped: it means
      // something wrote ACTIVE without going through `accept`.
      malformed += 1;
      logger.warn({ challengeId: challenge.id }, 'active duel has no start/end window');
      continue;
    }

    const [challengerXp, opponentXp] = await Promise.all([
      challenges.scoreFor(challenge.challengerId, challenge.category, startsAt, endsAt),
      challenges.scoreFor(challenge.opponentId, challenge.category, startsAt, endsAt),
    ]);

    const winnerId = decideDuelWinner(challenge, challengerXp, opponentXp);

    const outcome = await prisma.$transaction(async (tx) => {
      const update = await tx.challenge.updateMany({
        // `status: 'ACTIVE'` is the whole idempotency guard: a second run, a retry, or
        // the lazy read path having got here first all match zero rows.
        where: { id: challenge.id, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          challengerXp,
          opponentXp,
          winnerId,
          settledAt: now,
        },
      });
      if (update.count === 0) return { settled: false, notifications: 0 };

      const rows = [
        resultNotification(
          challenge.challenger,
          challenge.id,
          winnerId,
          challengerXp,
          opponentXp,
          now,
        ),
        resultNotification(
          challenge.opponent,
          challenge.id,
          winnerId,
          opponentXp,
          challengerXp,
          now,
        ),
      ].filter((row): row is Prisma.NotificationCreateManyInput => row !== null);

      if (rows.length === 0) return { settled: true, notifications: 0 };
      const created = await tx.notification.createMany({ data: rows });
      return { settled: true, notifications: created.count };
    });

    if (!outcome.settled) {
      alreadySettled += 1;
      continue;
    }

    processed += 1;
    notificationsWritten += outcome.notifications;
    if (winnerId === null) draws += 1;
  }

  logger.info(
    {
      settled: processed,
      expired: expired.length,
      alreadySettled,
      malformed,
      draws,
      notificationsWritten,
    },
    'duel settlement finished',
  );

  return {
    processed,
    expired: expired.length,
    alreadySettled,
    malformed,
    draws,
    notificationsWritten,
  };
}
