/**
 * Profile, analytics and the friends leaderboard.
 *
 * Four invariants shape everything in this file:
 *
 *  1. **Stats are raw XP in the database, never points.** `User.strengthXp` and its
 *     five siblings accumulate XP; the number a user sees is derived through
 *     `deriveStatSheet()`. Responses carry both, under names that say which is which
 *     (`stats` = displayed points, `statXp` = the accumulator), so no client can
 *     mistake one for the other and render 4,180 STR.
 *
 *  2. **Level comes from `levelProgress(cycleXp)`, never from local arithmetic.**
 *     `User.level` is a denormalised cache the schema itself calls a cache. Two
 *     implementations of the curve is one too many.
 *
 *  3. **Analytics read XpLedger, not the User counters.** The ledger is the source of
 *     truth by design (see the model comment): a reversal is a negative row, so
 *     summing the ledger is the only view that reflects corrections. `User.cycleXp`
 *     would happily report XP that was later clawed back.
 *
 *  4. **Every social read filters blocks in BOTH directions and skips soft-deleted
 *     users.** Hiding only the blocker's direction leaks the block to the blocked
 *     user, and `deletedAt` is not filtered by any global Prisma middleware — each
 *     query owns it.
 */

import type { PrismaClient, User } from '@prisma/client';
import {
  ALL_CATEGORIES,
  CLASS_UNLOCK_LEVEL,
  currentStreakAsOf,
  daysBetween,
  deriveStatSheet,
  levelProgress,
  localDateKey,
  suggestClass,
  totalStatPoints,
  type Category,
  type CharacterClass,
  type StatSheet,
} from '@habitwar/domain';

import { forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { definedOnly } from '../../lib/objects.js';
import type { UpdateProfileBody } from './schemas.js';

/** Injectable clock — keeps day-boundary and week-window logic deterministic under test. */
export type Clock = () => Date;

export interface ProfileServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

export type StatsPeriod = 'week' | 'month' | 'all';

/** Raw stat-XP accumulators, straight off the User row. NOT displayed values. */
export type StatXpSheet = StatSheet;

export interface StreakSummary {
  readonly habitId: string;
  readonly habitName: string;
  readonly category: Category;
  /**
   * Live streak as of the user's local today. Deliberately not `Habit.currentStreak`:
   * that column is only valid until the day rolls over, so reading it raw shows a
   * streak that has already lapsed as though it were alive.
   */
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastCompletedDate: string | null;
}

export interface OwnProfile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly timezone: string;
  readonly createdAt: Date;

  readonly progression: {
    readonly level: number;
    readonly xpIntoLevel: number;
    readonly xpForNextLevel: number;
    readonly ratio: number;
    readonly isMaxLevel: boolean;
    readonly cycleXp: number;
    /** Serialised: lifetimeXp is a BigInt column and JSON has no BigInt. */
    readonly lifetimeXp: string;
    readonly prestige: number;
  };

  /** Displayed stat POINTS, derived via deriveStatSheet(). */
  readonly stats: StatSheet;
  /** Raw accumulated stat XP — what the columns actually hold. */
  readonly statXp: StatXpSheet;
  readonly totalStatPoints: number;

  readonly characterClass: {
    readonly selected: CharacterClass | null;
    /** What the stat sheet points at. Null below CLASS_UNLOCK_LEVEL or with no stats. */
    readonly suggested: CharacterClass | null;
    readonly unlockLevel: number;
    readonly isUnlocked: boolean;
    /** Class is a permanent choice — see selectClass(). */
    readonly canChange: boolean;
  };

  readonly streaks: {
    readonly longestCurrent: number;
    readonly longestEver: number;
    readonly habits: readonly StreakSummary[];
  };

  readonly streakFreezes: number;
}

/**
 * The public view of someone else.
 *
 * Everything sensitive is absent by construction rather than by deletion: email,
 * timezone, streak freezes, the raw stat accumulators and the ledger never enter this
 * shape, so a future refactor cannot leak them by forgetting to strip a field.
 */
export interface PublicProfile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly createdAt: Date;
  readonly level: number;
  readonly prestige: number;
  readonly stats: StatSheet;
  readonly totalStatPoints: number;
  readonly characterClass: CharacterClass | null;
  readonly longestStreak: number;
  readonly isFriend: boolean;
}

export interface CategoryBreakdown {
  readonly category: Category;
  readonly xp: number;
  readonly sessions: number;
  readonly minutes: number;
}

export interface DailySeriesPoint {
  /** Local calendar day (YYYY-MM-DD) in the user's timezone. */
  readonly date: string;
  readonly xp: number;
  readonly sessions: number;
  readonly minutes: number;
}

export interface StatsReport {
  readonly period: StatsPeriod;
  /** Inclusive local start day; null for `all`, which has no lower bound. */
  readonly from: string | null;
  readonly to: string;
  readonly timezone: string;
  /** Net XP from the ledger — includes reversals and corrections, which are negative. */
  readonly totalXp: number;
  readonly sessionCount: number;
  readonly totalMinutes: number;
  readonly categories: readonly CategoryBreakdown[];
  readonly daily: readonly DailySeriesPoint[];
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly level: number;
  readonly characterClass: CharacterClass | null;
  readonly weeklyXp: number;
  readonly isMe: boolean;
}

export interface FriendsLeaderboard {
  /** Inclusive local day the week window opens on (Monday). */
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly timezone: string;
  readonly entries: readonly LeaderboardEntry[];
  /** The caller's own row, even when they fall outside `limit`. */
  readonly me: LeaderboardEntry | null;
}

export class ProfileService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: ProfileServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // GET /v1/users/me
  // -------------------------------------------------------------------------

  async getOwnProfile(userId: string): Promise<OwnProfile> {
    const user = await this.#requireLiveUser(userId);

    const habits = await this.#prisma.habit.findMany({
      where: { userId, isArchived: false },
      select: {
        id: true,
        name: true,
        category: true,
        currentStreak: true,
        longestStreak: true,
        lastCompletedDate: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const today = localDateKey(this.#now(), user.timezone);
    const streaks: StreakSummary[] = habits.map((habit) => ({
      habitId: habit.id,
      habitName: habit.name,
      category: habit.category as Category,
      currentStreak: currentStreakAsOf(
        {
          current: habit.currentStreak,
          longest: habit.longestStreak,
          lastCompleted: habit.lastCompletedDate,
        },
        today,
        user.streakFreezes,
      ),
      longestStreak: habit.longestStreak,
      lastCompletedDate: habit.lastCompletedDate,
    }));

    const statXp = statXpSheet(user);
    const stats = deriveStatSheet(statXp);
    const progress = levelProgress(user.cycleXp);

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      timezone: user.timezone,
      createdAt: user.createdAt,

      progression: {
        level: progress.level,
        xpIntoLevel: progress.xpIntoLevel,
        xpForNextLevel: progress.xpForNextLevel,
        ratio: progress.ratio,
        isMaxLevel: progress.isMaxLevel,
        cycleXp: user.cycleXp,
        lifetimeXp: user.lifetimeXp.toString(),
        prestige: user.prestige,
      },

      stats,
      statXp,
      totalStatPoints: totalStatPoints(stats),

      characterClass: {
        selected: user.classType as CharacterClass | null,
        suggested: suggestClass(stats, progress.level),
        unlockLevel: CLASS_UNLOCK_LEVEL,
        isUnlocked: progress.level >= CLASS_UNLOCK_LEVEL,
        canChange: user.classType === null,
      },

      streaks: {
        longestCurrent: streaks.reduce((max, row) => Math.max(max, row.currentStreak), 0),
        longestEver: streaks.reduce((max, row) => Math.max(max, row.longestStreak), 0),
        habits: streaks,
      },

      streakFreezes: user.streakFreezes,
    };
  }

  // -------------------------------------------------------------------------
  // PATCH /v1/users/me
  // -------------------------------------------------------------------------

  /**
   * Updates the mutable parts of a profile.
   *
   * `username` is deliberately absent: it is derived from the Clerk identity in
   * modules/users, it is the public handle other users resolve profiles by, and
   * renaming it is a distinct feature with its own collision and squatting problems.
   */
  async updateOwnProfile(userId: string, body: UpdateProfileBody): Promise<OwnProfile> {
    await this.#requireLiveUser(userId);

    // definedOnly() strips absent keys: under exactOptionalPropertyTypes an explicit
    // `undefined` is a type error for Prisma, and `bio: undefined` must mean "leave it
    // alone" while `bio: null` means "clear it".
    await this.#prisma.user.update({ where: { id: userId }, data: definedOnly(body) });

    return this.getOwnProfile(userId);
  }

  // -------------------------------------------------------------------------
  // GET /v1/users/:username
  // -------------------------------------------------------------------------

  /**
   * Public profile by username.
   *
   * Every negative outcome is the SAME 404: no such user, soft-deleted, they blocked
   * the viewer, or the viewer blocked them. Distinguishing them would confirm the
   * account exists and — worse — that a block is in place, which tells the blocked
   * user exactly what the block was meant not to tell them.
   */
  async getPublicProfile(viewerId: string, username: string): Promise<PublicProfile> {
    const user = await this.#prisma.user.findFirst({ where: { username, deletedAt: null } });
    if (!user) throw notFound('User not found');

    // Looking yourself up by username is legitimate and cannot be blocked.
    const isSelf = user.id === viewerId;
    if (!isSelf && (await this.#isBlockedEitherWay(viewerId, user.id))) {
      throw notFound('User not found');
    }

    const stats = deriveStatSheet(statXpSheet(user));
    const longest = await this.#prisma.habit.aggregate({
      where: { userId: user.id },
      _max: { longestStreak: true },
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      // Read through the curve rather than trusting the denormalised User.level cache.
      level: levelProgress(user.cycleXp).level,
      prestige: user.prestige,
      stats,
      totalStatPoints: totalStatPoints(stats),
      characterClass: user.classType as CharacterClass | null,
      longestStreak: longest._max.longestStreak ?? 0,
      isFriend: isSelf ? false : await this.#areFriends(viewerId, user.id),
    };
  }

  // -------------------------------------------------------------------------
  // GET /v1/users/me/stats
  // -------------------------------------------------------------------------

  /**
   * Period analytics, computed from XpLedger.
   *
   * XP and the session-shaped numbers come from two different places on purpose:
   *
   *  - **XP** is the ledger's net sum, so a reversed award reduces the total. The User
   *    counters cannot express that.
   *  - **Minutes and category** live on Session/Habit — the ledger has no category
   *    dimension (category is two joins away, on Habit) and no duration. So the ledger
   *    rows are joined to their sessions and the breakdown is folded from there.
   *
   * Ledger rows with no session (MANUAL_ADJUSTMENT, PRESTIGE_RESET, achievement
   * awards) still count toward `totalXp` but contribute no minutes and no category —
   * which is correct: no session happened.
   */
  async getStats(userId: string, period: StatsPeriod): Promise<StatsReport> {
    const user = await this.#requireLiveUser(userId);

    const now = this.#now();
    const today = localDateKey(now, user.timezone);
    const from = periodStart(now, user.timezone, period);

    const ledger = await this.#prisma.xpLedger.findMany({
      where: {
        userId,
        ...(from ? { createdAt: { gte: from.instant } } : {}),
      },
      select: {
        amount: true,
        createdAt: true,
        session: {
          select: {
            durationSec: true,
            status: true,
            habit: { select: { category: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byCategory = new Map<Category, { xp: number; sessions: number; minutes: number }>();
    const byDay = new Map<string, { xp: number; sessions: number; minutes: number }>();

    let totalXp = 0;
    let sessionCount = 0;
    let totalMinutes = 0;

    for (const row of ledger) {
      totalXp += row.amount;

      // Bucket by the user's LOCAL day, not by UTC: a 01:00 session in Istanbul is
      // yesterday in UTC, and a chart that disagrees with the user's own streak is
      // worse than no chart.
      const dayKey = localDateKey(row.createdAt, user.timezone);
      const day = byDay.get(dayKey) ?? { xp: 0, sessions: 0, minutes: 0 };
      day.xp += row.amount;

      const session = row.session;
      if (session && session.status === 'COMPLETED') {
        const minutes = Math.round((session.durationSec ?? 0) / 60);
        sessionCount += 1;
        totalMinutes += minutes;
        day.sessions += 1;
        day.minutes += minutes;

        const category = session.habit.category as Category;
        const bucket = byCategory.get(category) ?? { xp: 0, sessions: 0, minutes: 0 };
        bucket.xp += row.amount;
        bucket.sessions += 1;
        bucket.minutes += minutes;
        byCategory.set(category, bucket);
      }

      byDay.set(dayKey, day);
    }

    // Fixed category order (ALL_CATEGORIES) with zero-filled gaps, so a radar chart has
    // stable axes instead of ones that appear and disappear between requests.
    const categories: CategoryBreakdown[] = ALL_CATEGORIES.map((category) => {
      const bucket = byCategory.get(category) ?? { xp: 0, sessions: 0, minutes: 0 };
      return { category, xp: bucket.xp, sessions: bucket.sessions, minutes: bucket.minutes };
    });

    return {
      period,
      from: from?.dateKey ?? null,
      to: today,
      timezone: user.timezone,
      totalXp,
      sessionCount,
      totalMinutes,
      categories,
      daily: buildDailySeries(byDay, from?.dateKey ?? earliestKey(byDay) ?? today, today),
    };
  }

  // -------------------------------------------------------------------------
  // POST /v1/users/me/class
  // -------------------------------------------------------------------------

  /**
   * Selects a character class.
   *
   * TWO DECISIONS, both deliberate:
   *
   * 1. **Any unlocked class may be chosen — the suggestion is not a restriction.**
   *    `suggestClass()` reads the stat sheet and proposes the best fit, but a class is
   *    an identity statement and a goal, not a report card: someone grinding INT who
   *    wants to become a BERSERKER should be allowed to pick it and then play toward
   *    it. Forcing the suggestion would also make the choice meaningless — the server
   *    already knows the answer, so there would be nothing to choose. The economic
   *    risk is bounded: CLASS_BONUS is +10% and only applies to sessions feeding that
   *    class's two stats, so an off-build pick is a self-imposed penalty, not an
   *    exploit. The suggestion still ships in the response so the client can highlight
   *    it as the recommended option.
   *
   * 2. **The choice is permanent.** CLASS_BONUS gives +10% XP on sessions feeding the
   *    class's stats, so free re-selection is a pure exploit: switch to SCHOLAR before
   *    a study block, to BERSERKER before the gym, and every session earns the bonus —
   *    the bonus stops rewarding commitment and becomes a tax on users who do not
   *    micro-manage it. Permanence makes it a real decision, which is the point of
   *    having classes at all. A paid or cooldown-gated respec is a product decision for
   *    later; until one exists, refusing is the honest answer.
   */
  async selectClass(userId: string, classType: CharacterClass): Promise<OwnProfile> {
    const user = await this.#requireLiveUser(userId);

    // Read the level through the curve; User.level is a cache and could lag a write.
    const progress = levelProgress(user.cycleXp);
    if (progress.level < CLASS_UNLOCK_LEVEL) {
      throw forbidden(
        `Classes unlock at level ${CLASS_UNLOCK_LEVEL}; you are level ${progress.level}`,
      );
    }

    if (user.classType !== null) {
      // Re-sending the SAME class is idempotent: a retried request must not fail.
      if (user.classType === classType) return this.getOwnProfile(userId);
      throw unprocessable('Class has already been chosen and cannot be changed', {
        currentClass: user.classType,
      });
    }

    await this.#prisma.user.update({ where: { id: userId }, data: { classType } });
    return this.getOwnProfile(userId);
  }

  // -------------------------------------------------------------------------
  // GET /v1/leaderboard/friends
  // -------------------------------------------------------------------------

  /**
   * Weekly XP ranking across the caller's accepted friends, plus the caller.
   *
   * NO GLOBAL LEADERBOARD EXISTS, and none should be added: spec §10 lists a public
   * global ranking under "approach with caution" — it produces discouragement rather
   * than motivation. A friends board keeps the comparison inside a peer group the user
   * chose for themselves.
   *
   * Scored on THIS WEEK's ledger rather than lifetime XP so a newcomer is not
   * permanently last behind an account with a year of history; the week resets and
   * everyone starts level.
   *
   * XP from `isFlagged` sessions is excluded. That is the entire point of the anomaly
   * scan: a flagged session stays visible to its owner (schema comment on
   * Session.isFlagged) but must not move a ranking, or cheating still pays.
   */
  async friendsLeaderboard(userId: string, limit: number): Promise<FriendsLeaderboard> {
    const user = await this.#requireLiveUser(userId);

    const now = this.#now();
    const { weekStart, weekEnd, startInstant } = weekWindow(now, user.timezone);

    const friendIds = await this.#acceptedFriendIds(userId);
    // Blocks and friendship can disagree (blocking does not delete the Friendship row),
    // so the block filter runs over the friend set too — in both directions.
    const visibleIds = await this.#removeBlocked(userId, friendIds);
    const candidateIds = [userId, ...visibleIds];

    const users = await this.#prisma.user.findMany({
      where: { id: { in: candidateIds }, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        cycleXp: true,
        classType: true,
      },
    });

    // Grouping in the database keeps this one query regardless of friend count.
    const weekly = await this.#prisma.xpLedger.groupBy({
      by: ['userId'],
      where: {
        userId: { in: candidateIds },
        createdAt: { gte: startInstant },
        OR: [
          // Ledger rows with no session (adjustments, achievement awards) still count:
          // they are real XP and there is no session that could have been flagged.
          { sessionId: null },
          { session: { isFlagged: false, status: 'COMPLETED' } },
        ],
      },
      _sum: { amount: true },
    });

    const xpByUser = new Map(weekly.map((row) => [row.userId, row._sum.amount ?? 0]));

    const ranked = users
      .map((row) => ({
        userId: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        level: levelProgress(row.cycleXp).level,
        characterClass: row.classType as CharacterClass | null,
        weeklyXp: xpByUser.get(row.id) ?? 0,
        isMe: row.id === userId,
      }))
      // Ties break on username so the order is stable between requests — a board that
      // reshuffles equal scores on every poll reads as broken.
      .sort((a, b) => b.weeklyXp - a.weeklyXp || a.username.localeCompare(b.username))
      .map((row, index): LeaderboardEntry => ({ rank: index + 1, ...row }));

    return {
      weekStart,
      weekEnd,
      timezone: user.timezone,
      entries: ranked.slice(0, limit),
      me: ranked.find((row) => row.isMe) ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Loads the caller's row, refusing soft-deleted accounts.
   *
   * `deletedAt` is checked here rather than assumed from the auth plugin: the dev auth
   * path filters it, the Clerk path filters it, and this is the third place that must
   * agree. One helper, one rule.
   */
  async #requireLiveUser(userId: string): Promise<User> {
    const user = await this.#prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw notFound('User not found');
    return user;
  }

  /** True when either party has blocked the other. The direction is never disclosed. */
  async #isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const block = await this.#prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });
    return block !== null;
  }

  async #areFriends(a: string, b: string): Promise<boolean> {
    // pairKey is the direction-free identity the schema enforces uniqueness on, so a
    // single equality beats an OR over both orderings.
    const friendship = await this.#prisma.friendship.findFirst({
      where: { pairKey: pairKeyOf(a, b), status: 'ACCEPTED' },
      select: { id: true },
    });
    return friendship !== null;
  }

  /** Ids of accepted friends, from either side of the edge, excluding deleted users. */
  async #acceptedFriendIds(userId: string): Promise<string[]> {
    const rows = await this.#prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        // Soft-deleted accounts must not appear anywhere social. Nothing filters this
        // globally, so the query states it.
        requester: { deletedAt: null },
        addressee: { deletedAt: null },
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId));
  }

  /** Drops every id with a block in either direction against `userId`. */
  async #removeBlocked(userId: string, ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const blocks = await this.#prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: [...ids] } },
          { blockedId: userId, blockerId: { in: [...ids] } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const hidden = new Set(blocks.flatMap((row) => [row.blockerId, row.blockedId]));
    return ids.filter((id) => !hidden.has(id));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Reads the six raw stat-XP columns into the domain's sheet shape. */
function statXpSheet(user: {
  readonly strengthXp: number;
  readonly enduranceXp: number;
  readonly intelligenceXp: number;
  readonly wisdomXp: number;
  readonly charismaXp: number;
  readonly dexterityXp: number;
}): StatXpSheet {
  return {
    STR: user.strengthXp,
    END: user.enduranceXp,
    INT: user.intelligenceXp,
    WIS: user.wisdomXp,
    CHA: user.charismaXp,
    DEX: user.dexterityXp,
  };
}

/** The direction-free friendship identity the schema requires: sorted ids joined by ':'. */
function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** The zone's UTC offset in milliseconds at a given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  // Rendering the instant as a local wall clock and re-parsing it as if it were UTC
  // yields the offset. Intl owns the tz database, so DST needs no special handling.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  // Some ICU versions render midnight as hour "24"; normalise it.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const asUtc = Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}Z`,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant a local calendar day begins, as a UTC timestamp.
 *
 * Two passes, not one: the offset that applies is the zone's offset AT the resulting
 * instant, and a single-pass guess lands on the wrong side of a DST transition twice a
 * year. The second pass re-reads the offset at the candidate instant and corrects it.
 */
function startOfLocalDay(dateKey: string, timeZone: string): Date {
  const guess = new Date(`${dateKey}T00:00:00Z`);
  const firstPass = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - zoneOffsetMs(firstPass, timeZone));
}

/** Shifts a local date key by whole days. */
function addDays(dateKey: string, days: number): string {
  const shifted = new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The Monday-based week window containing `now` in the user's timezone.
 *
 * Monday rather than Sunday because the schema calls this a "league week" and the
 * product is Turkish-first, where the week starts on Monday.
 */
function weekWindow(
  now: Date,
  timeZone: string,
): { weekStart: string; weekEnd: string; startInstant: Date } {
  const today = localDateKey(now, timeZone);
  // getUTCDay on a date key parsed as UTC gives the weekday with no zone shift.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const weekStart = addDays(today, -sinceMonday);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    startInstant: startOfLocalDay(weekStart, timeZone),
  };
}

/** Inclusive lower bound of an analytics period, or null for `all`. */
function periodStart(
  now: Date,
  timeZone: string,
  period: StatsPeriod,
): { dateKey: string; instant: Date } | null {
  if (period === 'all') return null;
  const today = localDateKey(now, timeZone);
  // Rolling windows, not calendar ones: "this week" read on a Monday morning would
  // otherwise show a nearly empty chart and read as data loss.
  const dateKey = period === 'week' ? addDays(today, -6) : addDays(today, -29);
  return { dateKey, instant: startOfLocalDay(dateKey, timeZone) };
}

/** Earliest key present in the bucket map, or null when it is empty. */
function earliestKey(byDay: ReadonlyMap<string, unknown>): string | null {
  let earliest: string | null = null;
  for (const key of byDay.keys()) {
    if (earliest === null || key < earliest) earliest = key;
  }
  return earliest;
}

/** Upper bound on series length, so `period=all` on an old account stays bounded. */
const MAX_SERIES_POINTS = 400;

/**
 * Expands the day buckets into a gap-free series from `from` to `to`.
 *
 * Zero-filling matters: a chart drawn only from days that have data silently closes
 * the gaps, making a week with two missed days look continuous — which is exactly the
 * signal the user opened the screen to see.
 */
function buildDailySeries(
  byDay: ReadonlyMap<string, { xp: number; sessions: number; minutes: number }>,
  from: string,
  to: string,
): DailySeriesPoint[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];

  const start = span >= MAX_SERIES_POINTS ? addDays(to, -(MAX_SERIES_POINTS - 1)) : from;

  const series: DailySeriesPoint[] = [];
  for (let date = start; date <= to; date = addDays(date, 1)) {
    const bucket = byDay.get(date) ?? { xp: 0, sessions: 0, minutes: 0 };
    series.push({ date, xp: bucket.xp, sessions: bucket.sessions, minutes: bucket.minutes });
  }
  return series;
}
