/**
 * Game balance constants — the single source of truth.
 *
 * Every number that shapes the XP economy lives here. No magic numbers anywhere
 * else in the codebase: these values will be retuned constantly during beta, and
 * a retune must be a one-file change.
 *
 * Anywhere this deviates from docs/product-spec.md is marked "SPEC DEVIATION"
 * with the reason. See docs/adr/ for the longer arguments.
 */

import type { Category, CharacterClass, Stat, Verification } from './types.js';

// ---------------------------------------------------------------------------
// Level curve
// ---------------------------------------------------------------------------

/**
 * xpForLevel(n) = floor(LEVEL_BASE * n^LEVEL_EXPONENT)
 *
 * SPEC DEVIATION (§3.2). The spec used `floor(100 * n^1.6)`. Under the spec's own
 * "60 active minutes per day" assumption that curve puts level 50 at ~979,000 XP,
 * i.e. 22-45 years of play — while the same table claims "~2.5 years". The table's
 * own numbers also disagreed with its own formula (it lists 1,174 for level 5→6;
 * the formula yields 1,313).
 *
 * We inverted the problem: the spec's TIME targets are treated as the requirement,
 * and the curve parameters were fitted to them. At the reference rate of 75 XP/day:
 *   level 11 -> 29 days (target ~1 month)
 *   level 26 -> 196 days (target ~6 months)
 *   level 51 -> 854 days (target ~2.5 years)
 *   level 2  -> 30 XP, reachable in the very first session
 * These targets are locked down as assertions in leveling.test.ts.
 */
export const LEVEL_BASE = 30;
export const LEVEL_EXPONENT = 1.15;

/** Level at which Ascend (prestige) unlocks. Beyond it XP accrues but level does not. */
export const MAX_LEVEL = 50;

/**
 * Upper bound of the precomputed cumulative table. Must exceed MAX_LEVEL so the
 * boundary case (exactly at MAX_LEVEL) is representable.
 */
export const LEVEL_TABLE_MAX = MAX_LEVEL + 1;

/**
 * The reference user used to calibrate the economy: 60 active minutes per day at
 * an average total multiplier of 1.25. Documentation and tests only — no runtime
 * logic reads this.
 */
export const REFERENCE_DAILY_XP = 75;

// ---------------------------------------------------------------------------
// Prestige (Ascend)
// ---------------------------------------------------------------------------

/** Permanent XP bonus granted per Ascend. */
export const PRESTIGE_BONUS_STEP = 0.02;

/** Ceiling on the prestige bonus (10% => 5 ascensions). */
export const PRESTIGE_BONUS_CAP = 0.1;

// ---------------------------------------------------------------------------
// Multipliers
// ---------------------------------------------------------------------------

/**
 * Category difficulty multiplier. The axis is how much friction the habit carries
 * (physical/cognitive effort plus avoidance), not how long it takes.
 *
 * SPEC DEVIATION (§3.1). The spec gave a 0.8-1.5 range but never assigned a value
 * to any category. The range is deliberately narrowed to 0.85-1.25: a 1.5 ceiling
 * pushes users toward whichever category pays best rather than the habit they
 * actually want, which defeats the product's own purpose.
 */
export const DIFFICULTY_MULTIPLIER: Readonly<Record<Category, number>> = {
  FITNESS: 1.25,
  STUDY: 1.15,
  SKILL: 1.1,
  CREATIVE: 1.05,
  MINDFULNESS: 1.0,
  SOCIAL: 0.95,
  HEALTH: 0.85,
};

/** streakMultiplier = min(1 + days * STREAK_DAILY_INCREMENT, STREAK_MULTIPLIER_CAP) */
export const STREAK_DAILY_INCREMENT = 0.01;
export const STREAK_MULTIPLIER_CAP = 1.5;

/**
 * Focus quality multiplier, keyed on how many times the session was interrupted.
 * An "interruption" is the app being foregrounded or the timer being paused.
 * Tiers are [maxInterruptions, multiplier] in ascending order.
 *
 * SPEC DEVIATION (§3.1). The spec gave a 0.5-1.2 range but never said how it would
 * be measured. The floor is raised to 0.75 because halving XP contradicts the
 * spec's own "no punishment mechanics" principle (§10, §13).
 */
export const FOCUS_QUALITY_TIERS: readonly (readonly [number, number])[] = [
  [0, 1.2], // uninterrupted — the reward the spec asks for
  [2, 1.0], // 1-2 interruptions — neutral
  [5, 0.9], // 3-5 interruptions
  [Number.POSITIVE_INFINITY, 0.75], // 6+
];

/** Allowed range for the event multiplier. The value comes from the SERVER, never the client. */
export const EVENT_MULTIPLIER_MIN = 1.0;
export const EVENT_MULTIPLIER_MAX = 2.0;

/**
 * Verification multiplier — an integrity coefficient, not a reward.
 *
 * Deliberate design choice: sharing health data earns NO bonus. A bonus would make
 * granting health permissions economically coercive, which strains both KVKK's
 * "freely given consent" requirement and platform policy. All verified sources sit
 * at 1.0; only unverified manual entry is discounted.
 */
export const VERIFICATION_MULTIPLIER: Readonly<Record<Verification, number>> = {
  MANUAL_ENTRY: 0.3, // spec §4 Layer 1: "earns 30% XP"
  TIMER_ONLY: 1.0,
  HEALTH_DATA: 1.0,
  PHOTO_PROOF: 1.0,
  PEER_VERIFIED: 1.0,
};

/** XP bonus for sessions feeding one of the user's class stats (spec §3.3). */
export const CLASS_BONUS = 0.1;

/**
 * Ceiling on the product of all multipliers.
 *
 * SPEC DEVIATION: the spec had no such ceiling. Multiplied freely the theoretical
 * peak is 1.25 * 1.5 * 1.2 * 2.0 * 1.10 * 1.10 = 5.4x, and the spec defines further
 * modifiers elsewhere (Focus Mode +20%, equipment +5%) that were never in the
 * formula at all. Without a clamp the gap between a tuned account and an ordinary
 * one makes leaderboards meaningless.
 */
export const TOTAL_MULTIPLIER_CAP = 3.0;

// ---------------------------------------------------------------------------
// Daily caps and duration limits
// ---------------------------------------------------------------------------

/**
 * Per-category daily full-rate minute cap.
 *
 * SPEC FIX (§3.1 vs §4). The spec suggested "e.g. 120 min/day for reading". Seven
 * categories x 120 min is exactly 840 min = 14 hours, and §4 Layer 3 flags anomalies
 * at "> 14 hours" — so a user farming every cap to the limit would never be flagged.
 * Caps are now differentiated per category and backed by DAILY_TOTAL_CAP_MINUTES.
 */
export const DAILY_CATEGORY_CAP_MINUTES: Readonly<Record<Category, number>> = {
  STUDY: 180,
  SKILL: 150,
  CREATIVE: 150,
  FITNESS: 120,
  SOCIAL: 120,
  HEALTH: 90,
  MINDFULNESS: 60,
};

/** Full-rate daily cap across all categories combined (6 hours). */
export const DAILY_TOTAL_CAP_MINUTES = 360;

/**
 * Efficiency applied past a cap. Cutting XP to zero feels punitive (spec §3.1), so
 * XP keeps flowing at a reduced rate.
 */
export const OVER_CAP_EFFICIENCY = 0.2;

/**
 * Longest duration a single session can be credited for; anything beyond is clipped.
 * This bounds the "start the timer and walk away" attack.
 */
export const MAX_SESSION_MINUTES = 240;

/** Shortest creditable duration. Below this a session earns nothing. */
export const MIN_SESSION_MINUTES = 1;

/**
 * Daily total that the background anomaly scan treats as suspicious.
 * SPEC DEVIATION: the spec said 14 hours. With a 6-hour full-rate cap that threshold
 * could never fire in practice, so it is lowered to 8 hours.
 */
export const ANOMALY_DAILY_TOTAL_MINUTES = 480;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * XP-to-stat-point conversion.
 * SPEC GAP (§3.3): the spec calls stats "the thing that creates character identity"
 * but never defines how XP becomes stat points.
 */
export const STAT_POINT_DIVISOR = 20;

/**
 * Default stat for a category.
 * SPEC GAP: the spec defines 7 categories (§7 enum) and 6 stats (§3.3) but never
 * maps between them; which stat HEALTH feeds was undefined.
 */
export const CATEGORY_DEFAULT_STAT: Readonly<Record<Category, Stat>> = {
  FITNESS: 'STR',
  STUDY: 'INT',
  MINDFULNESS: 'WIS',
  CREATIVE: 'DEX',
  SOCIAL: 'CHA',
  HEALTH: 'WIS',
  SKILL: 'DEX',
};

/**
 * Stats a user may pick within a category.
 * Why this exists: the spec maps "weight training -> STR" but "running -> END", and
 * both are FITNESS. Category alone cannot determine the stat, so the stat is stored
 * on the habit.
 */
export const CATEGORY_ALLOWED_STATS: Readonly<Record<Category, readonly Stat[]>> = {
  FITNESS: ['STR', 'END'],
  STUDY: ['INT'],
  MINDFULNESS: ['WIS'],
  CREATIVE: ['DEX', 'CHA'],
  SOCIAL: ['CHA'],
  HEALTH: ['WIS', 'END'],
  SKILL: ['DEX', 'INT'],
};

/**
 * Stat pairs behind each class.
 * SPEC GAP: §3.3 describes 4 classes while the §7 ClassType enum has 6 values —
 * RANGER and ARTISAN were never defined anywhere.
 */
export const CLASS_STATS: Readonly<Record<CharacterClass, readonly [Stat, Stat]>> = {
  SCHOLAR: ['INT', 'WIS'],
  BERSERKER: ['STR', 'END'],
  BARD: ['CHA', 'DEX'],
  MONK: ['WIS', 'END'],
  RANGER: ['END', 'DEX'],
  ARTISAN: ['DEX', 'INT'],
};

/** Level at which the class suggestion unlocks (spec §3.3). */
export const CLASS_UNLOCK_LEVEL = 10;

// ---------------------------------------------------------------------------
// Enumerations in fixed order (radar charts, iteration, seeding)
// ---------------------------------------------------------------------------

export const ALL_STATS: readonly Stat[] = ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX'];

export const ALL_CATEGORIES: readonly Category[] = [
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'CREATIVE',
  'SOCIAL',
  'HEALTH',
  'SKILL',
];

export const ALL_CLASSES: readonly CharacterClass[] = [
  'SCHOLAR',
  'BERSERKER',
  'BARD',
  'MONK',
  'RANGER',
  'ARTISAN',
];
