/**
 * Game balance constants — the single source of truth.
 *
 * Every number that shapes the reading economy lives here. These values will be
 * retuned during beta, and a retune must be a one-file change.
 *
 * The product rules behind them are in docs/product-v2.md.
 */

// ---------------------------------------------------------------------------
// Level curve
// ---------------------------------------------------------------------------

/**
 * xpForLevel(n) = floor(LEVEL_BASE * n^LEVEL_EXPONENT)
 *
 * The exponent is the one fitted in docs/adr/0001-level-curve.md; only the base is
 * rescaled for reading. At the reference rate of REFERENCE_DAILY_XP:
 *   level 2  -> the very first day's reading
 *   level 11 -> about a month
 *   level 26 -> about six months
 *   level 50 -> two to three years
 * These targets are locked down as assertions in leveling.test.ts.
 */
export const LEVEL_BASE = 10;
export const LEVEL_EXPONENT = 1.15;

/** The highest level. Beyond it XP still accrues but level does not. */
export const MAX_LEVEL = 50;

/**
 * Upper bound of the precomputed cumulative table. Must exceed MAX_LEVEL so the
 * boundary case (exactly at MAX_LEVEL) is representable.
 */
export const LEVEL_TABLE_MAX = MAX_LEVEL + 1;

/**
 * The reference reader used to calibrate the curve: meets a 5-page goal every day,
 * i.e. 5 page XP + the daily goal bonus. Documentation and tests only.
 */
export const REFERENCE_DAILY_XP = 25;

// ---------------------------------------------------------------------------
// Reading XP
// ---------------------------------------------------------------------------

/** XP for each page read. */
export const XP_PER_PAGE = 1;

/**
 * Paid once per local day, the moment the day's pages reach the daily goal.
 *
 * Deliberately large next to XP_PER_PAGE: consistency must beat volume. Five pages a
 * day for ten days (250 XP) has to outrun a single 100-page binge (120 XP), or the
 * game rewards exactly the pattern that never becomes a habit.
 */
export const DAILY_GOAL_BONUS_XP = 20;

/**
 * Pages per local day that earn page XP. Pages beyond it still damage the book but
 * earn nothing — the cap is what keeps an inflated entry from buying levels.
 */
export const DAILY_PAGE_XP_CAP = 150;

/** Paid when a book is finished. */
export const BOOK_FINISHED_XP = 50;

// ---------------------------------------------------------------------------
// Goals and streaks
// ---------------------------------------------------------------------------

/** Daily goals a reader can choose, smallest first. */
export const DAILY_GOAL_OPTIONS: readonly number[] = [5, 10, 20];

export const DEFAULT_DAILY_GOAL = 10;

/**
 * Days that may be missed between two reading days without breaking the streak.
 * One: missing a day is forgiven, missing two in a row is not. Research on habit
 * formation finds a single missed day does not measurably set the habit back
 * (Lally et al., 2010); punishing it mostly teaches people to quit.
 */
export const STREAK_GRACE_DAYS = 1;

/** Window, in days, for the "days read" consistency figure. */
export const CONSISTENCY_WINDOW_DAYS = 30;

/** Days of history the smaller-goal suggestion looks at. */
export const GOAL_REVIEW_DAYS = 7;

/**
 * A smaller goal is suggested when the goal was met on fewer than this many of the
 * last GOAL_REVIEW_DAYS days. A goal missed most days is the wrong goal.
 */
export const GOAL_REVIEW_MIN_DAYS_MET = 4;

// ---------------------------------------------------------------------------
// Input limits
// ---------------------------------------------------------------------------

/** Largest page count a book may have. */
export const MAX_BOOK_PAGES = 5000;

/** Largest number of pages one log may record. */
export const MAX_PAGES_PER_LOG = 1000;
