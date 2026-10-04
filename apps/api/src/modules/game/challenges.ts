/**
 * Duels (spec §5.4): 1v1, 3-7 days.
 *
 * TWO KINDS, told apart by `task`:
 *
 *  - TASK DUELS (the current kind). Both sides commit to one daily task ("50 şınav")
 *    and check in once per day of the duel. A check-in counts unless the opponent
 *    disputes it; most undisputed days wins. Scored in days, not XP, so a veteran's
 *    streak and class multipliers buy nothing here — the duel is between two people
 *    on equal terms, and nothing about it can be won by leaving a timer running.
 *    It also pays: XP per day and bonuses at settlement (balance in
 *    `@habitwar/domain`), on top of the ordinary session economy, so entering a duel
 *    is worth more than training alone.
 *  - LEGACY XP DUELS (task null): most XP in one category wins. Kept so duels opened
 *    before task duels settle under the rules they were opened with.
 *
 * Decisions below that are about the legacy XP scoring are marked as such.
 *
 * Three decisions worth stating, because none of them is forced by the schema:
 *
 *  1. (Legacy XP duels.) SCORING IS DERIVED, NOT TRUSTED. `Challenge.challengerXp` / `opponentXp` exist
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

import {
  DUEL_DAILY_REWARD_LIMIT,
  DUEL_DAY_XP,
  DUEL_MAX_LIVE,
  duelDayIndex,
  duelLengthDays,
  duelSettlementReward,
} from '@habitwar/domain';
import type {
  Category,
  Challenge,
  ChallengeStatus,
  DuelCheckIn,
  Prisma,
  PrismaClient,
  User,
  XpReason,
} from '@prisma/client';

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
  /** The daily task. Null only for legacy XP duels, which tests still create. */
  readonly task?: string | null;
  readonly category?: Category | null;
  readonly days: number;
}

export interface ChallengeParticipant {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  /** The side's score: XP for a legacy duel, undisputed days for a task duel. */
  readonly xp: number;
  /** Same number as `xp`, under the name that is true for both kinds. */
  readonly score: number;
}

export interface CheckInView {
  readonly id: string;
  readonly userId: string;
  /** One-based day of the duel. */
  readonly day: number;
  readonly note: string | null;
  readonly disputed: boolean;
  readonly createdAt: Date;
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
  /** The daily task; null for a legacy XP duel. */
  readonly task: string | null;
  /** Length in days. Null until accepted. */
  readonly days: number | null;
  /** One-based day the duel is on now. Null unless ACTIVE and inside its window. */
  readonly currentDay: number | null;
  /** Both sides' check-ins, oldest first. Empty for a legacy duel. */
  readonly checkIns: readonly CheckInView[];
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
    const { userId, opponentUsername, days } = input;
    const category = input.category ?? null;
    const task = input.task?.trim() || null;

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

    // Live duels per person are capped. Settlement bonuses are paid per duel, so an
    // uncapped number of duels with agreeable friends would be an XP faucet; the cap
    // is also simply how many daily tasks a person can honestly keep.
    const [challengerLive, opponentLive] = await Promise.all([
      this.#liveCount(userId),
      this.#liveCount(opponent.id),
    ]);
    if (challengerLive >= DUEL_MAX_LIVE) {
      throw unprocessable(`En fazla ${DUEL_MAX_LIVE} düello aynı anda sürebilir.`, {
        limit: DUEL_MAX_LIVE,
      });
    }
    if (opponentLive >= DUEL_MAX_LIVE) {
      throw unprocessable('Bu kullanıcı şu an yeni bir düelloya katılamıyor.', {
        limit: DUEL_MAX_LIVE,
      });
    }

    const created = await this.#prisma.challenge.create({
      data: {
        challengerId: userId,
        opponentId: opponent.id,
        category,
        task,
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
      ...copy.challengeInvite(challenger.displayName, category, days, task),
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
      ...copy.challengeAccepted(updated.opponent.displayName, updated.category, days, updated.task),
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
   * Checks the caller in for today's task on a running task duel.
   *
   * Pays DUEL_DAY_XP unless the caller has already been paid for
   * DUEL_DAILY_REWARD_LIMIT check-ins in the last 24 hours; past that the check-in
   * still scores in its duel, it just earns nothing.
   *
   * Idempotent per day: a second check-in on the same duel day — a double tap, a
   * retried request — returns the duel unchanged rather than failing or paying twice.
   * The unique key on (challenge, user, day) is the guard, not a read-then-write.
   */
  async checkIn(userId: string, challengeId: string, note: string | null): Promise<ChallengeView> {
    const challenge = await this.#loadParticipating(userId, challengeId);
    if (challenge.task === null) {
      throw unprocessable('Only task duels take check-ins');
    }

    const now = this.#now();
    const dayIndex =
      challenge.status === 'ACTIVE' && challenge.startsAt && challenge.endsAt
        ? duelDayIndex(challenge.startsAt, challenge.endsAt, now)
        : null;
    if (dayIndex === null) {
      throw unprocessable('This duel is not running', { status: challenge.status });
    }

    const recentlyPaid = await this.#prisma.duelCheckIn.count({
      where: {
        userId,
        xpAwarded: { gt: 0 },
        createdAt: { gt: new Date(now.getTime() - MS_PER_DAY) },
      },
    });
    const xp = recentlyPaid < DUEL_DAILY_REWARD_LIMIT ? DUEL_DAY_XP : 0;
    const task = challenge.task;

    try {
      await this.#prisma.$transaction(async (tx) => {
        await tx.duelCheckIn.create({
          data: {
            challengeId,
            userId,
            dayIndex,
            note: note?.trim() || null,
            xpAwarded: xp,
            createdAt: now,
          },
        });
        if (xp > 0) {
          await applyDuelXp(tx, userId, xp, 'DUEL_REWARD', `Düello ${dayIndex + 1}. gün: ${task}`, now);
        }
      });
    } catch (error) {
      // Already checked in today: the designed outcome of a retry, not a failure.
      if (!isUniqueViolation(error)) throw error;
    }

    return this.#toView(challenge, userId);
  }

  /**
   * Disputes the opponent's check-in. The day stops counting and its XP is taken back.
   *
   * Only the other side may dispute, and only while the duel runs — a settled result
   * does not change under the players. Disputing an already-disputed check-in is a
   * no-op, so the reversal can never be applied twice.
   *
   * The disputed player is told, by name: unlike a duel result, this is a decision the
   * opponent made about them, and they should know whose it was.
   */
  async dispute(userId: string, challengeId: string, checkInId: string): Promise<ChallengeView> {
    const challenge = await this.#loadParticipating(userId, challengeId);
    if (challenge.status !== 'ACTIVE') {
      throw unprocessable('Only a running duel can be disputed', { status: challenge.status });
    }

    const checkIn = await this.#prisma.duelCheckIn.findFirst({
      where: { id: checkInId, challengeId },
    });
    if (!checkIn) throw notFound('Check-in not found');
    if (checkIn.userId === userId) {
      throw forbidden('You cannot dispute your own check-in');
    }

    const now = this.#now();
    const day = checkIn.dayIndex + 1;
    const changed = await this.#prisma.$transaction(async (tx) => {
      const update = await tx.duelCheckIn.updateMany({
        where: { id: checkIn.id, disputedAt: null },
        data: { disputedAt: now },
      });
      if (update.count === 0) return false;
      if (checkIn.xpAwarded > 0) {
        await applyDuelXp(
          tx,
          checkIn.userId,
          -checkIn.xpAwarded,
          'DUEL_REVERSAL',
          `Düello ${day}. gün işaretine itiraz edildi`,
          now,
        );
      }
      return true;
    });

    if (changed) {
      const actor = challenge.challengerId === userId ? challenge.challenger : challenge.opponent;
      await this.#notifications.createSafely({
        userId: checkIn.userId,
        actorId: userId,
        type: 'CHALLENGE_DISPUTED',
        ...copy.challengeDisputed(actor.displayName, day),
        targetType: 'CHALLENGE',
        targetId: challenge.id,
      });
    }

    return this.#toView(challenge, userId);
  }

  /**
   * One side's score.
   *
   * Task duel: undisputed check-ins. Legacy duel: XP from the ledger, see `scoreFor`.
   * Settlement and the live read both go through here, so a duel cannot be scored one
   * way while it runs and another way when it ends.
   */
  async sideScore(challenge: Challenge, userId: string, windowEnd: Date): Promise<number> {
    if (challenge.task !== null) {
      return this.#prisma.duelCheckIn.count({
        where: { challengeId: challenge.id, userId, disputedAt: null },
      });
    }
    if (!challenge.startsAt) return 0;
    return this.scoreFor(userId, challenge.category, challenge.startsAt, windowEnd);
  }

  /**
   * (Legacy XP duels.) Duel score: XP the user earned in the duel's category, inside
   * the duel's window, from sessions the anomaly scan has NOT flagged.
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
    // An empty XP window scores nothing. Task duels are exempt: they count check-in
    // rows, which exist from the first instant of the duel.
    if (challenge.task === null && windowEnd <= challenge.startsAt) {
      return { challengerXp: 0, opponentXp: 0 };
    }

    const [challengerXp, opponentXp] = await Promise.all([
      this.sideScore(challenge, challenge.challengerId, windowEnd),
      this.sideScore(challenge, challenge.opponentId, windowEnd),
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
   *
   * Task-duel settlement bonuses are paid in the same transaction as the status
   * change, under the same guard, so a duel is either settled and paid or neither.
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

      const challengerXp = await this.sideScore(challenge, challenge.challengerId, challenge.endsAt);
      const opponentXp = await this.sideScore(challenge, challenge.opponentId, challenge.endsAt);

      // A draw leaves winnerId null; `status` is the authority on "did this finish",
      // exactly as the schema comment states.
      const winnerId =
        challengerXp > opponentXp
          ? challenge.challengerId
          : opponentXp > challengerXp
            ? challenge.opponentId
            : null;

      const bonuses = await this.#prisma.$transaction(async (tx) => {
        const settled = await tx.challenge.updateMany({
          where: { id: challenge.id, status: 'ACTIVE' },
          data: { status: 'COMPLETED', challengerXp, opponentXp, winnerId, settledAt: now },
        });
        // Zero means somebody else settled this duel between the read and the write.
        // They paid and notified; doing either again would double both.
        if (settled.count === 0) return null;
        return payDuelSettlement(tx, challenge, challengerXp, opponentXp, now);
      });
      if (bonuses === null) continue;

      const isTask = challenge.task !== null;
      await this.#notifyDuelEnded(
        challenge.challengerId,
        challenge.id,
        challengerXp,
        opponentXp,
        isTask ? { bonusXp: bonuses.challengerBonus } : null,
      );
      await this.#notifyDuelEnded(
        challenge.opponentId,
        challenge.id,
        opponentXp,
        challengerXp,
        isTask ? { bonusXp: bonuses.opponentBonus } : null,
      );
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
    task: { readonly bonusXp: number } | null,
  ): Promise<void> {
    const outcome: DuelOutcome = ownXp > opponentXp ? 'WON' : ownXp < opponentXp ? 'LOST' : 'DRAW';
    await this.#notifications.createSafely({
      userId,
      actorId: null,
      type: 'CHALLENGE_ENDED',
      ...copy.challengeEnded(outcome, ownXp, opponentXp, task),
      targetType: 'CHALLENGE',
      targetId: challengeId,
    });
  }

  /** Loads a duel the caller is on either side of, with both participants. */
  async #loadParticipating(userId: string, challengeId: string): Promise<ChallengeWithUsers> {
    const challenge = await this.#prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { challenger: { select: participantSelect }, opponent: { select: participantSelect } },
    });
    // Reported as missing rather than forbidden, as in `#loadForDecision`.
    if (!challenge || (challenge.challengerId !== userId && challenge.opponentId !== userId)) {
      throw notFound('Challenge not found');
    }
    return challenge;
  }

  /** PENDING + ACTIVE duels the user is on either side of. */
  #liveCount(userId: string): Promise<number> {
    return this.#prisma.challenge.count({
      where: {
        status: { in: [...LIVE_STATUSES] },
        OR: [{ challengerId: userId }, { opponentId: userId }],
      },
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

    const now = this.#now();
    const daysRemaining =
      challenge.endsAt && challenge.status === 'ACTIVE'
        ? Math.max(0, Math.floor((challenge.endsAt.getTime() - now.getTime()) / MS_PER_DAY))
        : null;

    const dayIndex =
      challenge.status === 'ACTIVE' && challenge.startsAt && challenge.endsAt
        ? duelDayIndex(challenge.startsAt, challenge.endsAt, now)
        : null;

    const checkIns: DuelCheckIn[] =
      challenge.task !== null
        ? await this.#prisma.duelCheckIn.findMany({
            where: { challengeId: challenge.id },
            orderBy: [{ dayIndex: 'asc' }, { createdAt: 'asc' }],
          })
        : [];

    return {
      id: challenge.id,
      status: challenge.status,
      category: challenge.category,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      settledAt: challenge.settledAt,
      createdAt: challenge.createdAt,
      challenger: { ...challenge.challenger, xp: scores.challengerXp, score: scores.challengerXp },
      opponent: { ...challenge.opponent, xp: scores.opponentXp, score: scores.opponentXp },
      viewerIsChallenger: challenge.challengerId === viewerId,
      winnerId: challenge.winnerId,
      isDraw:
        challenge.status === 'COMPLETED' &&
        challenge.winnerId === null &&
        scores.challengerXp === scores.opponentXp,
      daysRemaining,
      task: challenge.task,
      // A PENDING duel has no window yet; its length is the one the challenger asked for.
      days:
        challenge.startsAt && challenge.endsAt
          ? duelLengthDays(challenge.startsAt, challenge.endsAt)
          : this.#requestedDays(challenge),
      currentDay: dayIndex === null ? null : dayIndex + 1,
      checkIns: checkIns.map((row) => ({
        id: row.id,
        userId: row.userId,
        day: row.dayIndex + 1,
        note: row.note,
        disputed: row.disputedAt !== null,
        createdAt: row.createdAt,
      })),
    };
  }
}

/**
 * Credits or debits duel XP: one ledger row and the matching change to the user's
 * cached totals, in the caller's transaction.
 *
 * `User.level` is left alone, as `grantAchievement` does: it is a sort cache derived
 * from cycleXp, the next session completion refreshes it, and every read path derives
 * the level through `levelProgress` anyway.
 */
export async function applyDuelXp(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  reason: XpReason,
  note: string,
  now: Date,
): Promise<void> {
  if (amount === 0) return;
  await tx.xpLedger.create({ data: { userId, amount, reason, note, createdAt: now } });
  await tx.user.update({
    where: { id: userId },
    data: {
      cycleXp: { increment: amount },
      lifetimeXp: { increment: BigInt(amount) },
    },
  });
}

/**
 * Pays a settled task duel's bonuses to both sides. Legacy XP duels pay nothing.
 *
 * Exported for the settlement job, which must pay exactly what the lazy read path
 * pays. Callers run it inside the transaction that flips the duel to COMPLETED and
 * only when that flip matched a row — that guard is what makes paying idempotent.
 */
export async function payDuelSettlement(
  tx: Prisma.TransactionClient,
  challenge: Challenge,
  challengerScore: number,
  opponentScore: number,
  now: Date,
): Promise<{ challengerBonus: number; opponentBonus: number }> {
  if (challenge.task === null || !challenge.startsAt || !challenge.endsAt) {
    return { challengerBonus: 0, opponentBonus: 0 };
  }
  const days = duelLengthDays(challenge.startsAt, challenge.endsAt);
  const challengerReward = duelSettlementReward({
    score: challengerScore,
    opponentScore,
    days,
  });
  const opponentReward = duelSettlementReward({
    score: opponentScore,
    opponentScore: challengerScore,
    days,
  });
  const note = `Düello sonucu: ${challenge.task}`;
  await applyDuelXp(tx, challenge.challengerId, challengerReward.total, 'DUEL_REWARD', note, now);
  await applyDuelXp(tx, challenge.opponentId, opponentReward.total, 'DUEL_REWARD', note, now);
  return { challengerBonus: challengerReward.total, opponentBonus: opponentReward.total };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
