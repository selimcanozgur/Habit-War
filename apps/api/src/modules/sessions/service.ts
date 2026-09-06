/**
 * Session lifecycle — start, complete, abandon.
 *
 * This is the only place XP is created, and it is the hottest correctness surface in
 * the product. Four rules the spec asserted but never implemented are enforced here:
 *
 *  1. Duration is measured server-side from startedAt/endedAt. The client never sends it.
 *  2. Completion is idempotent on clientRequestId, so a retry cannot award XP twice.
 *  3. A user may hold at most one ACTIVE session ("no parallel timers", spec §4 Layer 2).
 *  4. Every award is written to XpLedger before User.cycleXp is touched, so an
 *     incorrect award can be reversed and every total can be rebuilt from the ledger.
 */

import type { Prisma, PrismaClient, Session } from '@prisma/client';
import {
  ANOMALY_DAILY_TOTAL_MINUTES,
  MAX_SESSION_MINUTES,
  calculateSessionXp,
  currentStreakAsOf,
  advanceStreak,
  deriveStatSheet,
  detectLevelUp,
  levelProgress,
  localDateKey,
  resolveStat,
  statPointsFromXp,
  suggestClass,
  type Category,
  type Stat,
  type Verification,
  type XpResult,
} from '@habitwar/domain';

import { conflict, notFound, unprocessable } from '../../lib/errors.js';

/** Injectable clock — keeps the service deterministic under test. */
export type Clock = () => Date;

export interface SessionServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

export interface StartSessionInput {
  readonly userId: string;
  readonly habitId: string;
  readonly clientRequestId: string;
}

export interface CompleteSessionInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly clientRequestId: string;
  readonly interruptions: number;
  readonly verification: Verification;
  readonly proofUrl?: string | undefined;
}

export interface CompleteSessionResult {
  readonly session: Session;
  readonly xp: number;
  readonly statXp: number;
  /** Change in the displayed stat value; 0 when this session did not cross a point. */
  readonly statPointsGained: number;
  readonly stat: Stat;
  readonly hitDailyCap: boolean;
  readonly leveledUp: boolean;
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  readonly streak: number;
  readonly suggestedClass: string | null;
  /** True when this call replayed an already-completed session rather than scoring it. */
  readonly replayed: boolean;
}

export class SessionService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: SessionServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /**
   * Starts a session.
   *
   * Replays return the existing session rather than a conflict: a client that
   * retries after a dropped response must converge on the same session, not be told
   * it already started one it cannot see.
   */
  async start({ userId, habitId, clientRequestId }: StartSessionInput): Promise<Session> {
    const existing = await this.#prisma.session.findUnique({ where: { clientRequestId } });
    if (existing) {
      if (existing.userId !== userId) throw conflict('clientRequestId already used');
      return existing;
    }

    const habit = await this.#prisma.habit.findFirst({
      where: { id: habitId, userId, isArchived: false },
    });
    if (!habit) throw notFound('Habit not found');

    const now = this.#now();
    await this.#closeStaleSessions(userId, now);

    const active = await this.#prisma.session.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (active) {
      throw conflict('A session is already running', { activeSessionId: active.id });
    }

    return this.#prisma.session.create({
      data: { userId, habitId, clientRequestId, startedAt: now, status: 'ACTIVE' },
    });
  }

  /**
   * Completes a session and awards XP.
   *
   * Everything after scoring happens inside one transaction: ledger row, user
   * totals, daily usage and habit streak either all land or none do. A partial write
   * here means a user's level stops matching their ledger.
   */
  async complete(input: CompleteSessionInput): Promise<CompleteSessionResult> {
    const { userId, sessionId, clientRequestId, interruptions, verification, proofUrl } = input;

    const session = await this.#prisma.session.findFirst({
      where: { id: sessionId, userId },
      include: { habit: true },
    });
    if (!session) throw notFound('Session not found');

    if (session.status === 'COMPLETED') {
      // Idempotent replay: the client retried a request whose response it never saw.
      if (session.clientRequestId !== clientRequestId && clientRequestId !== session.id) {
        throw conflict('Session already completed');
      }
      return this.#describeCompleted(session, true);
    }
    if (session.status !== 'ACTIVE') {
      throw unprocessable(`Session is ${session.status.toLowerCase()} and cannot be completed`);
    }

    const now = this.#now();
    const durationSec = Math.max(0, Math.floor((now.getTime() - session.startedAt.getTime()) / 1000));

    const user = await this.#prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw notFound('User not found');

    const dateKey = localDateKey(now, user.timezone);
    const category = session.habit.category as Category;
    const stat = resolveStat(category, session.habit.stat as Stat | null);

    const usage = await this.#prisma.dailyUsage.findMany({ where: { userId, dateKey } });
    const minutesTodayInCategory =
      usage.find((row) => row.category === category)?.fullRateMinutes ?? 0;
    const minutesTodayTotal = usage.reduce((sum, row) => sum + row.fullRateMinutes, 0);

    const streakDays = currentStreakAsOf(
      {
        current: session.habit.currentStreak,
        longest: session.habit.longestStreak,
        lastCompleted: session.habit.lastCompletedDate,
      },
      dateKey,
      user.streakFreezes,
    );

    const result = calculateSessionXp({
      durationSec,
      category,
      stat,
      verification,
      streakDays,
      interruptions,
      characterClass: user.classType,
      prestige: user.prestige,
      // Season events are server-owned; wired up with the seasons module in Phase 2.
      eventMultiplier: 1,
      minutesTodayInCategory,
      minutesTodayTotal,
    });

    const streakUpdate = advanceStreak(
      {
        current: session.habit.currentStreak,
        longest: session.habit.longestStreak,
        lastCompleted: session.habit.lastCompletedDate,
      },
      dateKey,
      user.streakFreezes,
    );

    const cycleXpBefore = user.cycleXp;
    const { leveledUp, toLevel } = detectLevelUp(cycleXpBefore, result.xp);
    const progress = levelProgress(cycleXpBefore + result.xp);

    const flagged = minutesTodayTotal + result.breakdown.fullRateMinutes > ANOMALY_DAILY_TOTAL_MINUTES;

    const [updatedSession] = await this.#prisma.$transaction([
      this.#prisma.session.update({
        where: { id: session.id },
        data: {
          status: 'COMPLETED',
          endedAt: now,
          durationSec,
          interruptions,
          verification,
          proofUrl: proofUrl ?? null,
          xpAwarded: result.xp,
          statXp: result.statXp,
          multiplierData: result.breakdown as unknown as Prisma.InputJsonValue,
          isFlagged: flagged,
          flagReason: flagged ? 'DAILY_TOTAL_EXCEEDED' : null,
          flaggedAt: flagged ? now : null,
        },
      }),

      this.#prisma.xpLedger.create({
        data: {
          userId,
          sessionId: session.id,
          amount: result.xp,
          reason: 'SESSION_AWARD',
          note: `${session.habit.name} · ${result.breakdown.fullRateMinutes} min`,
        },
      }),

      this.#prisma.user.update({
        where: { id: userId },
        data: {
          cycleXp: { increment: result.xp },
          lifetimeXp: { increment: BigInt(result.xp) },
          level: toLevel,
          ...statColumnIncrement(stat, result.statXp),
          ...(streakUpdate.usedFreeze ? { streakFreezes: { decrement: 1 } } : {}),
        },
      }),

      this.#prisma.dailyUsage.upsert({
        where: { userId_dateKey_category: { userId, dateKey, category } },
        create: {
          userId,
          dateKey,
          category,
          fullRateMinutes: result.breakdown.fullRateMinutes,
          overCapMinutes: result.breakdown.overCapMinutes,
        },
        update: {
          fullRateMinutes: { increment: result.breakdown.fullRateMinutes },
          overCapMinutes: { increment: result.breakdown.overCapMinutes },
        },
      }),

      this.#prisma.habit.update({
        where: { id: session.habitId },
        data: {
          currentStreak: streakUpdate.current,
          longestStreak: streakUpdate.longest,
          lastCompletedDate: streakUpdate.lastCompleted,
        },
      }),
    ]);

    const statXpBefore = {
      STR: user.strengthXp,
      END: user.enduranceXp,
      INT: user.intelligenceXp,
      WIS: user.wisdomXp,
      CHA: user.charismaXp,
      DEX: user.dexterityXp,
    };
    const statXpAfter = { ...statXpBefore, [stat]: statXpBefore[stat] + result.statXp };
    const statPointsGained =
      statPointsFromXp(statXpAfter[stat]) - statPointsFromXp(statXpBefore[stat]);

    return {
      session: updatedSession,
      xp: result.xp,
      statXp: result.statXp,
      statPointsGained,
      stat,
      hitDailyCap: result.hitDailyCap,
      leveledUp,
      level: progress.level,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNextLevel: progress.xpForNextLevel,
      streak: streakUpdate.current,
      suggestedClass: user.classType ?? suggestClass(deriveStatSheet(statXpAfter), progress.level),
      replayed: false,
    };
  }

  /** Abandons an active session. No XP, no streak change. */
  async abandon(userId: string, sessionId: string): Promise<Session> {
    const session = await this.#prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw notFound('Session not found');
    if (session.status !== 'ACTIVE') {
      throw unprocessable(`Session is ${session.status.toLowerCase()} and cannot be abandoned`);
    }
    return this.#prisma.session.update({
      where: { id: sessionId },
      data: { status: 'ABANDONED', endedAt: this.#now() },
    });
  }

  /** The user's running session, if any. Powers cross-device timer sync. */
  async active(userId: string): Promise<Session | null> {
    const now = this.#now();
    await this.#closeStaleSessions(userId, now);
    return this.#prisma.session.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Abandons sessions left running past the maximum creditable duration.
   *
   * The spec never said who closes a session the user walked away from, which left
   * a forgotten timer blocking every future session for that user forever.
   */
  async #closeStaleSessions(userId: string, now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - MAX_SESSION_MINUTES * 60_000);
    await this.#prisma.session.updateMany({
      where: { userId, status: 'ACTIVE', startedAt: { lt: cutoff } },
      data: { status: 'ABANDONED', endedAt: now },
    });
  }

  async #describeCompleted(
    session: Session & { habit: { category: string; stat: string | null; currentStreak: number } },
    replayed: boolean,
  ): Promise<CompleteSessionResult> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    const progress = levelProgress(user.cycleXp);
    return {
      session,
      xp: session.xpAwarded,
      statXp: session.statXp,
      statPointsGained: 0,
      stat: resolveStat(session.habit.category as Category, session.habit.stat as Stat | null),
      hitDailyCap: false,
      leveledUp: false,
      level: progress.level,
      xpIntoLevel: progress.xpIntoLevel,
      xpForNextLevel: progress.xpForNextLevel,
      streak: session.habit.currentStreak,
      suggestedClass: user.classType,
      replayed,
    };
  }
}

/** Maps a domain stat onto its accumulated-XP column on User. */
function statColumnIncrement(stat: Stat, statXp: number): Prisma.UserUpdateInput {
  const column = {
    STR: 'strengthXp',
    END: 'enduranceXp',
    INT: 'intelligenceXp',
    WIS: 'wisdomXp',
    CHA: 'charismaXp',
    DEX: 'dexterityXp',
  }[stat];
  return { [column]: { increment: statXp } } as Prisma.UserUpdateInput;
}
