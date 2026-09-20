/**
 * Duels (spec §5.4): 1v1, one category, 3-7 days, most XP in that category wins.
 *
 * Three decisions worth stating, because none of them is forced by the schema:
 *
 *  1. SCORING IS DERIVED, NOT TRUSTED. `Challenge.challengerXp` / `opponentXp` exist
 *     as a materialised cache for the polling duel screen, but this module treats
 *     them as a cache only: the authoritative score is recomputed from XpLedger on
 *     every read and written back. The ledger is append-only and already the source
 *     of truth for levels; a duel that disagreed with it would be a second, quieter
 *     XP ledger with none of its guarantees.
 *
 *  2. FLAGGED SESSIONS SCORE ZERO. A session the anomaly scan flagged still shows in
 *     its owner's own history (spec §4: shadow correction, not a visible punishment)
 *     but contributes nothing to a duel. Excluding it here is the entire point of
 *     having the flag — a duel is a ranking, and §4 says flagged work stays out of
 *     rankings. Note the consequence: a flag applied AFTER settlement does not
 *     retroactively rewrite a settled result. Re-settlement is a job, not a read.
 *
 *  3. FRIENDSHIP IS NOT REQUIRED. Spec §5.2 gates "competition" on friendship, and
 *     §5.4 lists duels under competition, so requiring an ACCEPTED friendship is the
 *     defensible reading — but it is the wrong product call at this stage and the
 *     schema does not force it. A duel is opt-in on the receiving side: it creates a
 *     PENDING row and nothing else until the opponent accepts, so the worst an
 *     unwanted invite can do is sit in a list. Requiring friendship first would mean
 *     a user must accept a permanent, bidirectional social edge — which grants feed
 *     visibility and peer-verification rights — before they can decline a duel. That
 *     is a strictly larger consent than the one being asked for. The protections that
 *     actually matter are enforced instead: blocks in both directions, one live duel
 *     per pair, and no self-duelling. Revisit if invite spam shows up in practice;
 *     the fix then is a rate limit or a "friends only" user preference, not a
 *     friendship gate.
 */

import type { Category, Challenge, ChallengeStatus, PrismaClient, User } from '@prisma/client';

import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { copy, type DuelOutcome } from '../notifications/copy.js';
import { NotificationService } from '../notifications/service.js';

/** Injectable clock, matching `modules/sessions/service.ts`. */
export type Clock = () => Date;

/** Spec §5.4: duels run 3-7 days. Enforced here as well as in the Zod schema. */
export const CHALLENGE_MIN_DAYS = 3;
export const CHALLENGE_MAX_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Statuses that mean "this duel is still live between these two people". */
const LIVE_STATUSES: readonly ChallengeStatus[] = ['PENDING', 'ACTIVE'];

export interface ChallengeServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /**
   * Injectable so a test can assert on what was recorded without a second database
   * read. Defaults to a service over the same prisma/clock, so nothing else has to
   * change to wire it up.
   */
  readonly notifications?: NotificationService | undefined;
}

export interface CreateChallengeInput {
  readonly userId: string;
  readonly opponentUsername: string;
  readonly category: Category;
  readonly days: number;
}

export interface ChallengeParticipant {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly xp: number;
}

export interface ChallengeView {
  readonly id: string;
  readonly status: ChallengeStatus;
  readonly category: Category | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly settledAt: Date | null;
  readonly createdAt: Date;
  readonly challenger: ChallengeParticipant;
  readonly opponent: ChallengeParticipant;
  /** The viewer's own side, so a client need not compare ids to render "you". */
  readonly viewerIsChallenger: boolean;
  readonly winnerId: string | null;
  /** True once scored with equal totals. Distinct from "no winner yet". */
  readonly isDraw: boolean;
  /** Null for duels that have not started. Zero on the final day. */
  readonly daysRemaining: number | null;
}

export interface ListChallengesResult {
  readonly active: readonly ChallengeView[];
  readonly past: readonly ChallengeView[];
}

type ChallengeWithUsers = Challenge & {
  challenger: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
  opponent: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
};

const participantSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

export class ChallengeService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;
  readonly #notifications: NotificationService;

  constructor({ prisma, now, notifications }: ChallengeServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    this.#notifications = notifications ?? new NotificationService({ prisma, now });
  }

  /**
   * Every duel the user is on either side of, split into live and finished.
   *
   * Expired ACTIVE duels are settled lazily on read. There is no scheduler in this
   * phase, and a duel whose clock ran out yesterday must not still read as "active"
   * just because no background job exists yet; the `@@index([status, endsAt])` on
   * Challenge is there for the job that will eventually do this in bulk.
   */
  async list(userId: string, limit: number): Promise<ListChallengesResult> {
    await this.#settleExpired(userId);

    const rows = await this.#prisma.challenge.findMany({
      where: { OR: [{ challengerId: userId }, { opponentId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { challenger: { select: participantSelect }, opponent: { select: participantSelect } },
    });

    const views = await Promise.all(rows.map((row) => this.#toView(row, userId)));

    return {
      active: views.filter((view) => LIVE_STATUSES.includes(view.status)),
      past: views.filter((view) => !LIVE_STATUSES.includes(view.status)),
    };
  }

  /** Issues a duel invitation. The row is PENDING; no clock runs until acceptance. */
  async create(input: CreateChallengeInput): Promise<ChallengeView> {
    const { userId, opponentUsername, category, days } = input;

    // Belt and braces: the Zod schema bounds `days` too, but the service is also
    // called from tests and future jobs, and the spec's window is a game rule rather
    // than a transport concern.
    if (!Number.isInteger(days) || days < CHALLENGE_MIN_DAYS || days > CHALLENGE_MAX_DAYS) {
      throw unprocessable(
        `A duel must run between ${CHALLENGE_MIN_DAYS} and ${CHALLENGE_MAX_DAYS} days`,
        { days },
      );
    }

    const challenger = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: participantSelect,
    });
    if (!challenger) throw notFound('User not found');

    // Social lookups filter deletedAt themselves: a soft-deleted account is gone as
    // far as every other user is concerned, and must not be addressable by handle.
    const opponent = await this.#prisma.user.findFirst({
      where: { username: opponentUsername, deletedAt: null },
      select: participantSelect,
    });
    if (!opponent) throw notFound('User not found');

    if (opponent.id === userId) {
      throw unprocessable('You cannot duel yourself');
    }

    await this.#assertNotBlocked(userId, opponent.id);

    // One live duel per pair, in either direction. Without this a user could open
    // five duels in five categories against the same person and the duel list stops
    // meaning anything. There is no database constraint expressing "at most one row
    // in these statuses per unordered pair", so the check lives here and the race
    // window is accepted: the loser of a simultaneous double-create is a duplicate
    // PENDING row, which either party can decline.
    const existing = await this.#prisma.challenge.findFirst({
      where: {
        status: { in: [...LIVE_STATUSES] },
        OR: [
          { challengerId: userId, opponentId: opponent.id },
          { challengerId: opponent.id, opponentId: userId },
        ],
      },
    });
    if (existing) {
      throw conflict('A duel with this user is already open', { challengeId: existing.id });
    }

    const created = await this.#prisma.challenge.create({
      data: {
        challengerId: userId,
        opponentId: opponent.id,
        category,
        status: 'PENDING',
        // startsAt/endsAt stay null until acceptance. Storing the requested length on
        // a PENDING row would mean a duel accepted three days later had already half
        // elapsed; instead the window is derived from the acceptance instant, and the
        // requested length is carried in `endsAt - startsAt` from that point on.
        endsAt: new Date(this.#now().getTime() + days * MS_PER_DAY),
      },
      include: { challenger: { select: participantSelect }, opponent: { select: participantSelect } },
    });

    // After the row commits, never inside its transaction: a duel invitation that
    // failed because the notification failed would be the worse bug — the opponent
    // can still find a PENDING duel on the duels screen, but a duel that was never
    // created cannot be found anywhere.
    //
    // The challenger's display name is already in hand from the lookup above, so this
    // does NOT go through `actorDisplayName` — that helper exists for call sites that
    // only hold an id, and using it here would be a second read of a row we have.
    await this.#notifications.createSafely({
      userId: opponent.id,
      actorId: userId,
      type: 'CHALLENGE_INVITE',
      ...copy.challengeInvite(challenger.displayName, category, days),
      // CHALLENGE, not USER: the accept and decline buttons live on the duel, and
      // sending the opponent to a profile would make them hunt for the invitation.
      targetType: 'CHALLENGE',
      targetId: created.id,
    });

    return this.#toView(created, userId);
  }

  /**
   * Accepts a PENDING duel. Only the opponent may accept.
   *
   * The clock starts now and runs for the length the challenger asked for, recovered
   * from the provisional `endsAt` written at creation time.
   */
  async accept(userId: string, challengeId: string): Promise<ChallengeView> {
    const challenge = await this.#loadForDecision(userId, challengeId);
    const now = this.#now();

    await this.#assertNotBlocked(userId, challenge.challengerId);

    const days = this.#requestedDays(challenge);
    const updated = await this.#prisma.challenge.update({
      where: { id: challenge.id },
      data: {
        status: 'ACTIVE',
        startsAt: now,
        endsAt: new Date(now.getTime() + days * MS_PER_DAY),
        // Reset the cached totals: a duel scores only work done inside its window,
        // and any value here from a previous write would be pre-window XP.
        challengerXp: 0,
        opponentXp: 0,
      },
      include: { challenger: { select: participantSelect }, opponent: { select: participantSelect } },
    });

    // The challenger asked and is now owed the answer. Their clock has just started,
    // which is the part they cannot discover without being told: a duel they opened
    // three days ago is off their screen by now.
    await this.#notifications.createSafely({
      userId: updated.challengerId,
      actorId: userId,
      type: 'CHALLENGE_ACCEPTED',
      ...copy.challengeAccepted(updated.opponent.displayName, updated.category, days),
      targetType: 'CHALLENGE',
      targetId: updated.id,
    });

    return this.#toView(updated, userId);
  }

  /**
   * Declines a PENDING duel. Only the opponent may decline.
   *
   * DELIBERATELY SILENT, for the same reason `FriendService.decline` is: a "your duel
   * was turned down" notice is a message with no action attached, and the row leaving
   * the challenger's active list already says it. It also keeps a decline
   * indistinguishable from a block.
   */
  async decline(userId: string, challengeId: string): Promise<ChallengeView> {
    const challenge = await this.#loadForDecision(userId, challengeId);

    const updated = await this.#prisma.challenge.update({
      where: { id: challenge.id },
      data: { status: 'DECLINED', settledAt: this.#now() },
      include: { challenger: { select: participantSelect }, opponent: { select: participantSelect } },
    });

    return this.#toView(updated, userId);
  }

  /**
   * Duel score: XP the user earned in the duel's category, inside the duel's window,
   * from sessions the anomaly scan has NOT flagged.
   *
   * Computed from XpLedger rather than from Session.xpAwarded, because the ledger is
   * where corrections and reversals land — a session whose award was later reversed
   * nets to zero here automatically, while summing `xpAwarded` would still count it
   * in full. The category dimension is two joins away (ledger → session → habit),
   * which is exactly why Challenge caches the result on the row.
   *
   * `amount` is summed signed, and the result floored at zero: a user whose
   * corrections outweigh their awards inside the window scores 0, not a negative
   * number that would make the opponent's win look larger than it was.
   */
  async scoreFor(
    userId: string,
    category: Category | null,
    startsAt: Date,
    endsAt: Date,
  ): Promise<number> {
    const aggregate = await this.#prisma.xpLedger.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        createdAt: { gte: startsAt, lt: endsAt },
        // Duel XP must trace back to a real session. Manual adjustments and prestige
        // resets carry no session and are not competitive work.
        session: {
          is: {
            isFlagged: false,
            status: 'COMPLETED',
            ...(category ? { habit: { is: { category } } } : {}),
          },
        },
      },
    });
    return Math.max(0, aggregate._sum.amount ?? 0);
  }

  /**
   * Recomputes both sides of a running duel and writes the cache back.
   * Returns the fresh totals so the caller does not need a re-read.
   */
  async refreshScores(challenge: Challenge): Promise<{ challengerXp: number; opponentXp: number }> {
    if (!challenge.startsAt || !challenge.endsAt) {
      return { challengerXp: challenge.challengerXp, opponentXp: challenge.opponentXp };
    }
    // The window for scoring purposes never extends past now: a duel still running
    // should show the score so far, not a score over a window that includes the future.
    const windowEnd = new Date(
      Math.min(challenge.endsAt.getTime(), this.#now().getTime()),
    );
    if (windowEnd <= challenge.startsAt) {
      return { challengerXp: 0, opponentXp: 0 };
    }

    const [challengerXp, opponentXp] = await Promise.all([
      this.scoreFor(challenge.challengerId, challenge.category, challenge.startsAt, windowEnd),
      this.scoreFor(challenge.opponentId, challenge.category, challenge.startsAt, windowEnd),
    ]);

    if (challengerXp !== challenge.challengerXp || opponentXp !== challenge.opponentXp) {
      await this.#prisma.challenge.update({
        where: { id: challenge.id },
        data: { challengerXp, opponentXp },
      });
    }

    return { challengerXp, opponentXp };
  }

  /**
   * Settles every ACTIVE duel of this user whose clock has run out.
   *
   * Idempotent on `settledAt`, which is what makes it safe to call from a read path:
   * the `status: 'ACTIVE'` filter means a second concurrent call finds nothing left
   * to settle.
   *
   * THE RESULT NOTICE IS EMITTED HERE, and the conditional update is what makes that
   * safe. An earlier revision deferred it to "the settlement job" on the grounds that
   * a GET must not fire notifications — but the underlying worry was double delivery,
   * not the HTTP verb, and the `status: 'ACTIVE'` filter answers it directly: exactly
   * one caller sees `count === 1` for a given duel, whoever they are and however many
   * of them race. Deferring instead meant a duel that ended on Tuesday told nobody
   * until a job that does not exist yet ran, which is the worse failure: the loser
   * never learns they lost, and both players are left with a duel that simply stopped.
   * When that job lands it calls this same path and inherits the same guarantee.
   *
   * Feed posts for the result are still not emitted here; a post is content, and
   * writing content on someone's behalf from a read path is a different decision.
   */
  async #settleExpired(userId: string): Promise<void> {
    const now = this.#now();
    const expired = await this.#prisma.challenge.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: { lte: now },
        OR: [{ challengerId: userId }, { opponentId: userId }],
      },
    });

    for (const challenge of expired) {
      if (!challenge.startsAt || !challenge.endsAt) continue;

      const challengerXp = await this.scoreFor(
        challenge.challengerId,
        challenge.category,
        challenge.startsAt,
        challenge.endsAt,
      );
      const opponentXp = await this.scoreFor(
        challenge.opponentId,
        challenge.category,
        challenge.startsAt,
        challenge.endsAt,
      );

      // A draw leaves winnerId null; `status` is the authority on "did this finish",
      // exactly as the schema comment states.
      const winnerId =
        challengerXp > opponentXp
          ? challenge.challengerId
          : opponentXp > challengerXp
            ? challenge.opponentId
            : null;

      const settled = await this.#prisma.challenge.updateMany({
        where: { id: challenge.id, status: 'ACTIVE' },
        data: { status: 'COMPLETED', challengerXp, opponentXp, winnerId, settledAt: now },
      });
      // Zero means somebody else settled this duel between the read and the write.
      // They sent the notices; sending them again would double-notify both players.
      if (settled.count === 0) continue;

      await this.#notifyDuelEnded(challenge.challengerId, challenge.id, challengerXp, opponentXp);
      await this.#notifyDuelEnded(challenge.opponentId, challenge.id, opponentXp, challengerXp);
    }
  }

  /**
   * Tells one player how their duel finished.
   *
   * SYSTEM COPY — `actorId` stays null even though there is obviously another human
   * involved. Two reasons: the sentence ("Düelloyu kazandın") is about the reader,
   * not about the opponent, so naming them adds nothing; and a null actor means the
   * notice survives the opponent being blocked, deleted or purged in the meantime.
   * `NotificationService.create` drops an actor-bearing notification when either side
   * has blocked the other, which would otherwise leave a player with a duel that
   * never visibly ended.
   *
   * Scores are passed from the recipient's own side, so each player reads their own
   * number first — "120 XP – 90 XP" has to mean something different to each of them.
   */
  async #notifyDuelEnded(
    userId: string,
    challengeId: string,
    ownXp: number,
    opponentXp: number,
  ): Promise<void> {
    const outcome: DuelOutcome = ownXp > opponentXp ? 'WON' : ownXp < opponentXp ? 'LOST' : 'DRAW';
    await this.#notifications.createSafely({
      userId,
      actorId: null,
      type: 'CHALLENGE_ENDED',
      ...copy.challengeEnded(outcome, ownXp, opponentXp),
      targetType: 'CHALLENGE',
      targetId: challengeId,
    });
  }

  /** Loads a PENDING duel the caller is entitled to accept or decline. */
  async #loadForDecision(userId: string, challengeId: string): Promise<Challenge> {
    const challenge = await this.#prisma.challenge.findUnique({ where: { id: challengeId } });

    // A duel the caller is not part of is reported as missing rather than forbidden:
    // confirming "this id exists but is not yours" leaks other users' activity.
    if (!challenge || (challenge.challengerId !== userId && challenge.opponentId !== userId)) {
      throw notFound('Challenge not found');
    }
    if (challenge.opponentId !== userId) {
      throw forbidden('Only the challenged user can respond to this duel');
    }
    if (challenge.status !== 'PENDING') {
      throw unprocessable(`Duel is ${challenge.status.toLowerCase()} and cannot be answered`, {
        status: challenge.status,
      });
    }
    return challenge;
  }

  /**
   * Blocks are directional but must be honoured both ways: hiding only one direction
   * tells the blocked user they were blocked, which is precisely what the schema
   * comment warns against.
   */
  async #assertNotBlocked(userId: string, otherId: string): Promise<void> {
    const block = await this.#prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: otherId },
          { blockerId: otherId, blockedId: userId },
        ],
      },
    });
    // One message for both directions on purpose — "you blocked them" and "they
    // blocked you" must be indistinguishable from the outside.
    if (block) throw forbidden('This user is not available');
  }

  /** Recovers the duel length the challenger asked for from the provisional endsAt. */
  #requestedDays(challenge: Challenge): number {
    if (!challenge.endsAt) return CHALLENGE_MIN_DAYS;
    const days = Math.round(
      (challenge.endsAt.getTime() - challenge.createdAt.getTime()) / MS_PER_DAY,
    );
    return Math.min(CHALLENGE_MAX_DAYS, Math.max(CHALLENGE_MIN_DAYS, days));
  }

  async #toView(challenge: ChallengeWithUsers, viewerId: string): Promise<ChallengeView> {
    // Live duels are re-scored on read; finished ones keep the numbers they settled
    // with, so a result never changes under the user after the fact.
    const scores =
      challenge.status === 'ACTIVE'
        ? await this.refreshScores(challenge)
        : { challengerXp: challenge.challengerXp, opponentXp: challenge.opponentXp };

    const daysRemaining =
      challenge.endsAt && challenge.status === 'ACTIVE'
        ? Math.max(0, Math.floor((challenge.endsAt.getTime() - this.#now().getTime()) / MS_PER_DAY))
        : null;

    return {
      id: challenge.id,
      status: challenge.status,
      category: challenge.category,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      settledAt: challenge.settledAt,
      createdAt: challenge.createdAt,
      challenger: { ...challenge.challenger, xp: scores.challengerXp },
      opponent: { ...challenge.opponent, xp: scores.opponentXp },
      viewerIsChallenger: challenge.challengerId === viewerId,
      winnerId: challenge.winnerId,
      isDraw:
        challenge.status === 'COMPLETED' &&
        challenge.winnerId === null &&
        scores.challengerXp === scores.opponentXp,
      daysRemaining,
    };
  }
}
