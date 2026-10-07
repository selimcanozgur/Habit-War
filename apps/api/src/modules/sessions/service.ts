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
  STALE_SESSION_MINUTES,
  activeSessionSeconds,
  countLogMinutes,
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

import { startOfLocalDay } from '../../lib/calendar.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { FeedService } from '../feed/service.js';
import { evaluateAchievements } from '../game/achievements.js';
import { StoryService, type StorySessionResult } from '../game/story.js';
import { resolveEventMultiplier } from '../game/seasons.js';

/** Injectable clock — keeps the service deterministic under test. */
export type Clock = () => Date;

export interface SessionServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /** Optional logger. After-effect failures are logged, never thrown. */
  readonly log?: { error: (obj: unknown, msg: string) => void };
  /**
   * Feed writer, injectable so a test can prove an after-effect failure does not
   * cost the user their XP. Defaults to a FeedService sharing this clock.
   */
  readonly feed?: Pick<FeedService, 'upsertDailyDigest'>;
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
  /** Badge codes unlocked by this session, if any. */
  readonly unlockedAchievements: readonly string[];
  /** True when this call replayed an already-completed session rather than scoring it. */
  readonly replayed: boolean;
  /** What the session did to the story. Null on a replay or if it could not be read. */
  readonly story: StorySessionResult | null;
}

export class SessionService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;
  readonly #feed: Pick<FeedService, 'upsertDailyDigest'>;
  readonly #log: SessionServiceDeps['log'];
  readonly #story: StoryService;

  constructor({ prisma, now, log, feed }: SessionServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    this.#log = log;
    // Shares the clock so a digest lands on the same local day the session did.
    this.#feed = feed ?? new FeedService({ prisma, now });
    this.#story = new StoryService({ prisma, now });
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
   * Logs a count habit — "+10 şınav" — and scores it as the session it is worth.
   *
   * The log becomes an ordinary session whose length is its credit in whole minutes
   * (`countLogMinutes`, on the day's running total), and goes through `complete` like
   * any other: same XP formula, streak, daily caps, feed digest and monster hit. Nothing
   * about the economy is reimplemented, so a count habit cannot drift from a timed one.
   * Past the day's target a log still records the count, credited zero minutes.
   *
   * Idempotent on `clientRequestId`, like start and complete.
   */
  async logCount(input: {
    userId: string;
    habitId: string;
    count: number;
    clientRequestId: string;
  }): Promise<CompleteSessionResult> {
    const { userId, habitId, count, clientRequestId } = input;

    const replay = await this.#prisma.session.findUnique({
      where: { clientRequestId },
      include: { habit: true },
    });
    if (replay) {
      if (replay.userId !== userId) throw conflict('clientRequestId already used');
      if (replay.status === 'COMPLETED') return this.#describeCompleted(replay, true);
    }

    const habit = await this.#prisma.habit.findFirst({
      where: { id: habitId, userId, isArchived: false },
    });
    if (!habit) throw notFound('Habit not found');
    if (habit.kind !== 'COUNT' || habit.targetCount === null) {
      throw unprocessable('Only a count habit can be logged by count');
    }

    const user = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { timezone: true },
    });
    if (!user) throw notFound('User not found');

    const now = this.#now();
    const dayStart = startOfLocalDay(localDateKey(now, user.timezone), user.timezone);
    const logged = await this.#prisma.session.aggregate({
      where: { habitId, status: 'COMPLETED', endedAt: { gte: dayStart } },
      _sum: { count: true },
    });
    const minutes = countLogMinutes(logged._sum.count ?? 0, count, habit.targetCount);

    // Backdated by its credit, so `complete` measures exactly that many minutes.
    const session =
      replay ??
      (await this.#prisma.session.create({
        data: {
          userId,
          habitId,
          clientRequestId,
          startedAt: new Date(now.getTime() - minutes * 60_000),
          status: 'ACTIVE',
          count,
        },
      }));

    return this.complete({
      userId,
      sessionId: session.id,
      clientRequestId,
      interruptions: 0,
      verification: 'TIMER_ONLY',
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
    // Paused time is not credited: wall time minus resumed pauses, minus the running
    // pause if the session is completed while paused.
    const durationSec = activeSessionSeconds(session, now);
    // A pause is an interruption (domain: FOCUS_QUALITY_TIERS). Counted server-side,
    // where it is recorded, rather than trusted to a client that may have restarted.
    const totalInterruptions = interruptions + session.pauseCount;

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

    // Server-owned, never accepted from the client: the event multiplier is the one
    // input to the XP formula a client could most profitably lie about. Resolved from
    // the active season; 1.0 when none is running.
    const eventMultiplier = await resolveEventMultiplier(this.#prisma, now);

    const result = calculateSessionXp({
      durationSec,
      category,
      stat,
      verification,
      streakDays,
      interruptions: totalInterruptions,
      characterClass: user.classType,
      prestige: user.prestige,
      eventMultiplier,
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
          interruptions: totalInterruptions,
          // A session completed while paused closes its pause here.
          pausedAt: null,
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

    const unlocked = await this.#runAfterEffects({
      userId,
      habitName: session.habit.name,
      category,
      xp: result.xp,
      minutes: result.breakdown.fullRateMinutes,
      at: now,
    });

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
      unlockedAchievements: unlocked,
      replayed: false,
      story: await this.#storyHit(userId, session.id),
    };
  }

  /**
   * The story hit for the reward screen. Outside the award transaction and isolated,
   * like the other after-effects: the story is derived from the session, so a failure
   * here loses a line on a screen, never the XP.
   */
  async #storyHit(userId: string, sessionId: string): Promise<StorySessionResult | null> {
    try {
      return await this.#story.afterSession(userId, sessionId);
    } catch (error) {
      this.#log?.error({ err: error, sessionId }, 'story hit could not be computed');
      return null;
    }
  }

  /**
   * Side effects that follow a completed session: badge evaluation and the daily
   * digest post.
   *
   * Deliberately OUTSIDE the award transaction. Both are secondary to the XP itself,
   * and rolling back a correctly-earned session because a feed post failed to write
   * would be the wrong trade — the user would lose real minutes to a cosmetic
   * failure. Each is isolated so one failing cannot take the other with it.
   *
   * Both are safe to repeat: `evaluateAchievements` is idempotent on
   * `@@unique([userId, achievementId])`, and `upsertDailyDigest` is an upsert on
   * `@@unique([authorId, digestDate])`. The caller is protected from double-counting
   * upstream by `Session.clientRequestId`.
   */
  async #runAfterEffects(input: {
    userId: string;
    habitName: string;
    category: Category;
    xp: number;
    minutes: number;
    at: Date;
  }): Promise<string[]> {
    const { userId, category, xp, minutes, at } = input;

    let unlocked: string[] = [];

    try {
      const result = await evaluateAchievements(this.#prisma, userId, at);
      unlocked = [...result.unlocked];
    } catch (error) {
      this.#log?.error({ err: error, userId }, 'achievement evaluation failed after a session');
    }

    // The spec's answer to feed spam: automatic session posts collapse into one
    // digest per day. A standalone SESSION_COMPLETE post stays a manual choice.
    try {
      await this.#feed.upsertDailyDigest({ userId, xp, minutes, category, at });
    } catch (error) {
      this.#log?.error({ err: error, userId }, 'daily digest upsert failed after a session');
    }

    return unlocked;
  }

  /**
   * Pauses a running session. The pause is not credited, and counts as an
   * interruption when the session completes.
   *
   * Idempotent: pausing a paused session returns it unchanged, so a double tap or a
   * retry cannot count two pauses.
   */
  async pause(userId: string, sessionId: string): Promise<Session> {
    const session = await this.#activeSession(userId, sessionId);
    if (session.pausedAt !== null) return session;
    const now = this.#now();
    const updated = await this.#prisma.session.updateMany({
      where: { id: session.id, status: 'ACTIVE', pausedAt: null },
      data: { pausedAt: now, pauseCount: { increment: 1 } },
    });
    if (updated.count === 0) return this.#activeSession(userId, sessionId);
    return this.#prisma.session.findUniqueOrThrow({ where: { id: session.id } });
  }

  /** Resumes a paused session; the pause's length joins `pausedSec`. Idempotent. */
  async resume(userId: string, sessionId: string): Promise<Session> {
    const session = await this.#activeSession(userId, sessionId);
    if (session.pausedAt === null) return session;
    const now = this.#now();
    const pausedFor = Math.max(0, Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000));
    const updated = await this.#prisma.session.updateMany({
      // Matching on the pausedAt we read is the guard: a concurrent resume that got
      // there first leaves nothing to match, so a pause is never added twice.
      where: { id: session.id, status: 'ACTIVE', pausedAt: session.pausedAt },
      data: { pausedAt: null, pausedSec: { increment: pausedFor } },
    });
    if (updated.count === 0) return this.#activeSession(userId, sessionId);
    return this.#prisma.session.findUniqueOrThrow({ where: { id: session.id } });
  }

  async #activeSession(userId: string, sessionId: string): Promise<Session> {
    const session = await this.#prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw notFound('Session not found');
    if (session.status !== 'ACTIVE') {
      throw unprocessable(`Session is ${session.status.toLowerCase()} and cannot be paused or resumed`);
    }
    return session;
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
    // Wall time, so the pause budget is included: see STALE_SESSION_MINUTES.
    const cutoff = new Date(now.getTime() - STALE_SESSION_MINUTES * 60_000);
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
      unlockedAchievements: [],
      replayed,
      // A replay already showed its hit when it first completed.
      story: null,
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
