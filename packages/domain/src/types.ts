/**
 * Habit War core types.
 *
 * This package is pure TypeScript: zero runtime dependencies, no I/O, no Date.now().
 * Anything time-dependent is passed in as a parameter, which keeps the engine
 * testable and guarantees the server and the client compute identical results.
 */

/** Habit category. Must stay in sync with the Prisma `Category` enum. */
export type Category =
  | 'FITNESS'
  | 'STUDY'
  | 'MINDFULNESS'
  | 'CREATIVE'
  | 'SOCIAL'
  | 'HEALTH'
  | 'SKILL';

/** RPG stat. Stored as separate Int columns on the Prisma `User` model. */
export type Stat = 'STR' | 'END' | 'INT' | 'WIS' | 'CHA' | 'DEX';

/** Character class. Must stay in sync with the Prisma `ClassType` enum. */
export type CharacterClass = 'SCHOLAR' | 'BERSERKER' | 'BARD' | 'MONK' | 'RANGER' | 'ARTISAN';

/**
 * How a session was verified.
 *
 * MANUAL_ENTRY did not exist in the spec's Section 7 enum, even though Section 4
 * (Layer 1) describes manual entry earning "30% XP". That rule is unenforceable
 * without an enum value to represent it, so it was added here.
 */
export type Verification =
  | 'MANUAL_ENTRY'
  | 'TIMER_ONLY'
  | 'HEALTH_DATA'
  | 'PHOTO_PROOF'
  | 'PEER_VERIFIED';

/** Everything needed to score a single session. */
export interface SessionInput {
  /** Measured active duration in seconds. Derived server-side from startedAt/endedAt. */
  readonly durationSec: number;
  readonly category: Category;
  /** The stat this session feeds. Set on the habit; falls back to the category default. */
  readonly stat: Stat;
  readonly verification: Verification;
  /** The habit's streak in days, as of the start of this session. */
  readonly streakDays: number;
  /** Times the session was interrupted. Counted by the client, validated server-side. */
  readonly interruptions: number;
  /** The user's class, if any. Sessions matching a class stat earn a bonus. */
  readonly characterClass: CharacterClass | null;
  /** How many times the user has ascended. Each grants a permanent +2% XP (capped at 10%). */
  readonly prestige: number;
  /**
   * Active season/event multiplier. Set by the SERVER — never trusted from the client.
   * Clamped into [1.0, 2.0].
   */
  readonly eventMultiplier: number;
  /** Minutes already earned at full rate in this category today. */
  readonly minutesTodayInCategory: number;
  /** Minutes already earned at full rate across all categories today. */
  readonly minutesTodayTotal: number;
}

/** Auditable breakdown of every multiplier applied. Persisted as Session.multiplierData. */
export interface MultiplierBreakdown {
  readonly baseXp: number;
  readonly fullRateMinutes: number;
  readonly overCapMinutes: number;
  readonly difficulty: number;
  readonly streak: number;
  readonly focusQuality: number;
  readonly event: number;
  readonly verification: number;
  readonly characterClass: number;
  readonly prestige: number;
  /** Compound multiplier before clamping — lets the UI show what the cap cost. */
  readonly rawTotal: number;
  /** Compound multiplier after TOTAL_MULTIPLIER_CAP; this is what was actually applied. */
  readonly total: number;
}

/** Result of scoring one session. */
export interface XpResult {
  readonly xp: number;
  /**
   * XP credited to the stat. Stats accumulate raw XP and the displayed point value
   * is derived from it, so short sessions are never rounded away to nothing.
   */
  readonly statXp: number;
  readonly stat: Stat;
  readonly breakdown: MultiplierBreakdown;
  /** True when the daily cap was hit — the client must surface this explicitly. */
  readonly hitDailyCap: boolean;
}

/** The user's six stats. */
export type StatSheet = Readonly<Record<Stat, number>>;

/** Level progression state. */
export interface LevelProgress {
  readonly level: number;
  /** XP accumulated inside the current level. */
  readonly xpIntoLevel: number;
  /** XP required at this level to reach the next one. */
  readonly xpForNextLevel: number;
  /** 0..1 — what the XP bar renders. */
  readonly ratio: number;
  /** Whether max level is reached (Ascend is available). */
  readonly isMaxLevel: boolean;
}
