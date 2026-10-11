/**
 * Streaks and day boundaries.
 *
 * The hard part of streaks is not the counter, it is deciding when "today" ends.
 * Every user has their own timezone, so the day boundary is a per-user question and
 * the whole module is written around a local date key (YYYY-MM-DD) rather than
 * timestamps. Comparing raw UTC timestamps would break a streak for anyone west of
 * UTC who logs a session late at night.
 *
 * The reading streak is per user. Missed days are forgiven up to STREAK_GRACE_DAYS
 * (balance.ts), which callers pass as `freezesAvailable` below.
 */

/** A calendar day in a specific timezone, formatted YYYY-MM-DD. */
export type LocalDateKey = string;

/**
 * The user's local calendar day for an instant.
 *
 * Uses Intl (built into the runtime, no dependency) rather than hand-rolled offset
 * arithmetic, so DST transitions are handled by the platform's tz database.
 *
 * @throws RangeError if the timezone is not recognised — falling back to UTC would
 *   silently corrupt streaks for that user.
 */
export function localDateKey(instant: Date, timeZone: string): LocalDateKey {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // 'en-CA' formats as YYYY-MM-DD, which sorts lexicographically as it does chronologically.
  return formatter.format(instant);
}

/** Whole days between two local date keys. Negative if `to` precedes `from`. */
export function daysBetween(from: LocalDateKey, to: LocalDateKey): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new RangeError(`daysBetween: invalid date key(s): "${from}", "${to}"`);
  }
  return Math.round((toMs - fromMs) / 86_400_000);
}

export interface StreakState {
  readonly current: number;
  readonly longest: number;
  /** The local day the habit was last completed, or null if never. */
  readonly lastCompleted: LocalDateKey | null;
}

export interface StreakUpdate extends StreakState {
  /** True when this completion extended the streak rather than continuing it same-day. */
  readonly extended: boolean;
  /** True when a freeze absorbed a missed day. */
  readonly usedFreeze: boolean;
}

/**
 * Advances a streak for a completion on `today`.
 *
 * Rules:
 * - Same day as the last completion: streak unchanged (a second session does not
 *   double the streak).
 * - Exactly one day later: streak increments.
 * - A gap of at most `freezesAvailable` missed days: forgiven, streak increments.
 * - A larger gap: streak resets to 1.
 *
 * `freezesAvailable` is the number of missed days a gap may contain; for reading it
 * is STREAK_GRACE_DAYS.
 */
export function advanceStreak(
  state: StreakState,
  today: LocalDateKey,
  freezesAvailable = 0,
): StreakUpdate {
  if (state.lastCompleted === null) {
    return {
      current: 1,
      longest: Math.max(1, state.longest),
      lastCompleted: today,
      extended: true,
      usedFreeze: false,
    };
  }

  const gap = daysBetween(state.lastCompleted, today);

  if (gap < 0) {
    // Out-of-order completion (clock skew, or a backfilled session). Leave the
    // streak alone rather than corrupting it.
    return { ...state, extended: false, usedFreeze: false };
  }

  if (gap === 0) {
    return { ...state, lastCompleted: today, extended: false, usedFreeze: false };
  }

  const missedDays = gap - 1;
  const canFreeze = missedDays > 0 && missedDays <= freezesAvailable;

  if (gap === 1 || canFreeze) {
    const current = state.current + 1;
    return {
      current,
      longest: Math.max(current, state.longest),
      lastCompleted: today,
      extended: true,
      usedFreeze: canFreeze && gap > 1,
    };
  }

  return {
    current: 1,
    longest: Math.max(1, state.longest),
    lastCompleted: today,
    extended: true,
    usedFreeze: false,
  };
}

/**
 * The streak as of `today`, without recording a completion.
 *
 * A stored `currentStreak` is only valid until the day rolls over; reading the raw
 * column would show a broken streak as though it were alive. Read paths (profile,
 * feed, XP preview) must go through this.
 */
export function currentStreakAsOf(
  state: StreakState,
  today: LocalDateKey,
  freezesAvailable = 0,
): number {
  if (state.lastCompleted === null) return 0;
  const gap = daysBetween(state.lastCompleted, today);
  if (gap <= 0) return state.current;
  if (gap === 1) return state.current; // yesterday: still alive, today is not over
  const missedDays = gap - 1;
  return missedDays <= freezesAvailable ? state.current : 0;
}
