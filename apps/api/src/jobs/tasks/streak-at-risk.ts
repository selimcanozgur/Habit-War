/**
 * Streak-at-risk reminders.
 *
 * Writes an in-app `Notification` for users whose streak ends at THEIR local midnight
 * unless they log something today. It does not push: delivery is a separate concern
 * with its own 3-per-day cap (`DAILY_PUSH_LIMIT`), and a reminder that only exists
 * once a push succeeds is a reminder the user loses when their token is stale.
 *
 * ---------------------------------------------------------------------------
 * THE TIMEZONE PROBLEM, AND WHY THIS JOB RUNS HOURLY
 * ---------------------------------------------------------------------------
 * The obvious build is a daily cron: once a day, warn everyone whose streak is about
 * to break. It is wrong, and it is wrong in a way that only shows up once the user
 * base leaves one country.
 *
 * A streak breaks at the USER'S midnight. `Habit.lastCompletedDate` is a local date
 * key precisely because the day boundary is a per-user question — the same instant is
 * "still Tuesday" in São Paulo and "already Wednesday" in Istanbul. A single daily UTC
 * run therefore fires at a different local hour for every user: pick 17:00 UTC and a
 * Turkish user is warned at 20:00 with four hours to act, a Californian at 10:00 in
 * the morning about a day they have barely started, and a New Zealander at 06:00 the
 * NEXT DAY — after the streak they were supposed to save has already been lost. There
 * is no UTC hour that is a reasonable evening hour everywhere; that is what a timezone
 * is.
 *
 * So the schedule and the selection are separated:
 *
 *   - The CRON is hourly and in UTC (`STREAK_AT_RISK_CRON`, `SCHEDULER_TIMEZONE`),
 *     which is a stable, DST-proof heartbeat and nothing more.
 *   - The SELECTION is per user: `localHour(now, user.timezone)` asks the platform's
 *     tz database what time it is on that user's wall clock, and only users for whom
 *     it is `STREAK_REMINDER_LOCAL_HOUR` (20:00) are warned on this tick.
 *
 * Each user is therefore matched by exactly one of the 24 ticks per day, so the job is
 * hourly and the reminder is daily. Two properties come free from asking the tz
 * database rather than doing offset arithmetic:
 *
 *   - HALF-HOUR AND QUARTER-HOUR ZONES WORK. Asia/Kolkata (+05:30) is at 20:30 local
 *     when it is 15:00 UTC, and `localHour` returns 20 — one tick, not zero. An
 *     implementation comparing UTC offsets to whole hours would never fire for
 *     Kolkata, Kathmandu (+05:45) or Chatham (+12:45).
 *   - DST IS NOT A SPECIAL CASE. The user's wall clock is read through `Intl`, so the
 *     match simply lands an hour earlier or later in UTC on the days the clocks move.
 *     A zone that skipped 20:00 entirely would skip that day's reminder; no zone in
 *     the tz database transitions at 20:00, and the dedupe window below is 23 hours
 *     rather than 24 for the same family of reasons.
 *
 * COST. The hour cannot be filtered in SQL — Postgres would need the user's zone
 * joined against a tz table to answer it — so candidates are narrowed by the thing
 * that IS indexable (having a live streak at all) and the hour test runs in process
 * over that set. It is a bounded scan of users-with-streaks once an hour, and it is
 * why `selectDueUsers` is pure: the part with the interesting logic needs no database
 * to test.
 *
 * IDEMPOTENT. Two guards. The candidate set only contains users whose streak is alive
 * and untouched today, so re-running after the user logs a session selects nobody; and
 * a user warned within `STREAK_AT_RISK_DEDUPE_WINDOW_HOURS` is skipped, so a retry
 * inside the same hour — or two ticks racing across a DST boundary — cannot warn twice.
 */

import { daysBetween, localDateKey } from '@habitwar/domain';
import type { Prisma } from '@prisma/client';

import { clamp } from '../../modules/notifications/copy.js';
import {
  MS_PER_HOUR,
  STREAK_AT_RISK_DEDUPE_WINDOW_HOURS,
  STREAK_AT_RISK_MIN_DAYS,
  STREAK_REMINDER_LOCAL_HOUR,
} from '../constants.js';
import type { JobContext, JobOutcome } from '../context.js';
import { isValidTimeZone, localHour } from '../time.js';

/** Schema limits, mirrored from `Notification.title` / `.body`. */
const TITLE_MAX = 120;
const BODY_MAX = 500;

/** A habit name is user-controlled and up to 80 chars; the sentence needs room too. */
const HABIT_NAME_MAX = 40;

/** `Habit.lastCompletedDate` is an unvalidated VarChar(10). Trust nothing. */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface ReminderCandidate {
  readonly id: string;
  readonly timezone: string;
}

export interface StreakHabit {
  readonly name: string;
  readonly currentStreak: number;
  readonly lastCompletedDate: string | null;
}

export interface StreakAtRiskResult extends JobOutcome {
  /** Notifications written. */
  readonly processed: number;
  /** Users with a live streak, before the local-hour filter. */
  readonly candidates: number;
  /** Users for whom it is the reminder hour right now. */
  readonly due: number;
  /** Due users already warned inside the dedupe window. */
  readonly deduped: number;
  /** Due users whose streaks turned out not to be at risk today. */
  readonly notAtRisk: number;
  /** Users skipped because `User.timezone` is not a zone the runtime knows. */
  readonly invalidTimezones: number;
}

/**
 * The users whose own clock has just reached the reminder hour. Pure.
 *
 * A bad timezone is separated out rather than thrown on: `User.timezone` is a plain
 * string column with no database-level validation, so one corrupt row must not be able
 * to take down every other user's reminder. They are returned, not swallowed, so the
 * caller can log a count that somebody can act on.
 */
export function selectDueUsers<T extends ReminderCandidate>(
  users: readonly T[],
  now: Date,
  reminderHour: number = STREAK_REMINDER_LOCAL_HOUR,
): { due: T[]; invalidTimezones: T[] } {
  const due: T[] = [];
  const invalidTimezones: T[] = [];

  for (const user of users) {
    if (!isValidTimeZone(user.timezone)) {
      invalidTimezones.push(user);
      continue;
    }
    if (localHour(now, user.timezone) === reminderHour) due.push(user);
  }

  return { due, invalidTimezones };
}

/**
 * Whether this habit's streak ends tonight unless the user acts. Pure.
 *
 * The test is a gap of exactly ONE local day since the last completion:
 *
 *   gap 0  — already completed today. Nothing at risk; warning would be spam.
 *   gap 1  — completed yesterday, nothing today. The streak is alive and dies at
 *            local midnight. This is the only case worth a notification.
 *   gap 2+ — at least one whole day was already missed, so the warning is late by a
 *            day or more. Telling someone their streak is "at risk" after it broke is
 *            worse than saying nothing.
 *
 * `streakFreezes` is deliberately NOT consulted. A freeze would absorb the miss, but
 * it is a finite resource the user is never asked about — spending one silently
 * because we decided not to mention the risk is a worse outcome than a reminder they
 * can ignore.
 *
 * Total by construction: an unparseable date key returns false instead of throwing,
 * for the same reason a bad timezone is filtered rather than raised.
 */
export function isHabitAtRisk(
  habit: StreakHabit,
  todayKey: string,
  minDays: number = STREAK_AT_RISK_MIN_DAYS,
): boolean {
  if (habit.currentStreak < minDays) return false;
  const last = habit.lastCompletedDate;
  if (last === null || !DATE_KEY_PATTERN.test(last) || !DATE_KEY_PATTERN.test(todayKey)) {
    return false;
  }
  return daysBetween(last, todayKey) === 1;
}

/**
 * The at-risk habit the notification is written about, and how many others are in the
 * same position. Pure.
 *
 * The longest streak leads, because that is the one the user has the most to lose on
 * and the number that makes the sentence worth reading. One notification per user, not
 * per habit: three habits at risk is one evening's work, and three separate pings for
 * it is precisely the spam the 3-per-day cap exists to prevent.
 */
export function pickHeadlineHabit(
  habits: readonly StreakHabit[],
  todayKey: string,
  minDays: number = STREAK_AT_RISK_MIN_DAYS,
): { headline: StreakHabit; alsoAtRisk: number } | null {
  const atRisk = habits.filter((habit) => isHabitAtRisk(habit, todayKey, minDays));
  const [first, ...rest] = [...atRisk].sort((a, b) => b.currentStreak - a.currentStreak);
  if (!first) return null;
  return { headline: first, alsoAtRisk: rest.length };
}

/**
 * Turkish copy for the reminder. Pure.
 *
 * Lives here rather than in `modules/notifications/copy.ts` because this job is its
 * only writer and the module has no streak builder; it follows that file's rules all
 * the same, since they are correctness rules and not style ones — rendered at write
 * time so push delivery can hand the stored row straight to Expo, and clamped to the
 * column widths, because Postgres rejects an over-long value rather than truncating it
 * and a user with a 200-character habit name would otherwise get no reminder at all.
 *
 * The sentence is built so that every interpolation lands in a suffix-safe position:
 * Turkish agreement would otherwise need the habit's final vowel, and "Kitap okumaı"
 * is worse than a slightly plainer sentence.
 */
export function streakAtRiskCopy(
  habit: StreakHabit,
  alsoAtRisk: number,
): { title: string; body: string | null } {
  const clamped = clamp(habit.name, HABIT_NAME_MAX);
  // A blank name would produce " için bugün henüz bir seans yok."; the fallback is
  // shaped to keep the sentence grammatical rather than merely non-empty.
  const name = clamped.length > 0 ? clamped : 'Bir alışkanlık';

  const title = clamp(`${habit.currentStreak} günlük serin bugün sona eriyor`, TITLE_MAX);

  const subject =
    alsoAtRisk === 0
      ? `${name} için bugün henüz bir seans yok.`
      : `${name} ve ${alsoAtRisk} alışkanlık daha bugün seans bekliyor.`;

  return {
    title,
    body: clamp(`${subject} Kısa bir seans bile seriyi sürdürmeye yeter.`, BODY_MAX),
  };
}

export async function runStreakAtRisk(context: JobContext): Promise<StreakAtRiskResult> {
  const { prisma, now, logger } = context;

  // The only part of the selection Postgres can do: users who still have a streak long
  // enough to be worth defending. `frequency` is deliberately not filtered on — every
  // streak in `@habitwar/domain` is counted in days regardless of it, so excluding
  // WEEKLY habits would silently drop counters that really are ticking daily.
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      habits: { some: { isArchived: false, currentStreak: { gte: STREAK_AT_RISK_MIN_DAYS } } },
    },
    select: { id: true, timezone: true },
  });

  const { due, invalidTimezones } = selectDueUsers(candidates, now);
  if (invalidTimezones.length > 0) {
    logger.warn(
      {
        count: invalidTimezones.length,
        userIds: invalidTimezones.slice(0, 10).map((user) => user.id),
      },
      'skipping users with an unrecognised timezone',
    );
  }

  const empty: StreakAtRiskResult = {
    processed: 0,
    candidates: candidates.length,
    due: due.length,
    deduped: 0,
    notAtRisk: 0,
    invalidTimezones: invalidTimezones.length,
  };

  // 23 of every 24 ticks legitimately match nobody, so this is the normal path.
  if (due.length === 0) {
    logger.info({ ...empty, notified: 0 }, 'streak-at-risk finished');
    return empty;
  }

  const since = new Date(now.getTime() - STREAK_AT_RISK_DEDUPE_WINDOW_HOURS * MS_PER_HOUR);
  const warned = await prisma.notification.findMany({
    where: {
      userId: { in: due.map((user) => user.id) },
      type: 'STREAK_AT_RISK',
      createdAt: { gte: since },
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  const alreadyWarned = new Set(warned.map((row) => row.userId));

  const targets = due.filter((user) => !alreadyWarned.has(user.id));
  const deduped = due.length - targets.length;

  if (targets.length === 0) {
    const outcome = { ...empty, deduped };
    logger.info({ ...outcome, notified: 0 }, 'streak-at-risk finished');
    return outcome;
  }

  const habits = await prisma.habit.findMany({
    where: {
      userId: { in: targets.map((user) => user.id) },
      isArchived: false,
      currentStreak: { gte: STREAK_AT_RISK_MIN_DAYS },
    },
    select: { userId: true, name: true, currentStreak: true, lastCompletedDate: true },
  });

  const byUser = new Map<string, StreakHabit[]>();
  for (const habit of habits) {
    const bucket = byUser.get(habit.userId);
    if (bucket) bucket.push(habit);
    else byUser.set(habit.userId, [habit]);
  }

  const rows: Prisma.NotificationCreateManyInput[] = [];
  let notAtRisk = 0;

  for (const user of targets) {
    // Each user's own calendar day. Computing one shared "today" would mis-date every
    // user who is not in the server's zone, which is the same bug in a smaller place.
    const todayKey = localDateKey(now, user.timezone);
    const picked = pickHeadlineHabit(byUser.get(user.id) ?? [], todayKey);
    if (!picked) {
      notAtRisk += 1;
      continue;
    }

    const text = streakAtRiskCopy(picked.headline, picked.alsoAtRisk);
    rows.push({
      userId: user.id,
      // System notification: no actor. `NotificationService`'s self and block guards
      // exist for actor-driven copy and do not apply; the deleted-recipient guard is
      // already covered by `deletedAt: null` in the candidate query.
      actorId: null,
      type: 'STREAK_AT_RISK',
      title: text.title,
      body: text.body,
      // No HABIT member in NotificationTargetType, and inventing one would be a schema
      // change. The reminder opens the app, which is where the timer lives anyway.
      targetType: null,
      targetId: null,
      createdAt: now,
    });
  }

  const created =
    rows.length === 0 ? { count: 0 } : await prisma.notification.createMany({ data: rows });

  const outcome: StreakAtRiskResult = {
    processed: created.count,
    candidates: candidates.length,
    due: due.length,
    deduped,
    notAtRisk,
    invalidTimezones: invalidTimezones.length,
  };

  logger.info({ ...outcome, notified: created.count }, 'streak-at-risk finished');
  return outcome;
}
