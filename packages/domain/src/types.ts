/**
 * Habit War core types.
 *
 * This package is pure TypeScript: zero runtime dependencies, no I/O, no Date.now().
 * Anything time-dependent is passed in as a parameter, which keeps the engine
 * testable and guarantees the server and the client compute identical results.
 */

/** Level progression state. */
export interface LevelProgress {
  readonly level: number;
  /** XP accumulated inside the current level. */
  readonly xpIntoLevel: number;
  /** XP required at this level to reach the next one. */
  readonly xpForNextLevel: number;
  /** 0..1 — what the XP bar renders. */
  readonly ratio: number;
  /** Whether max level is reached. */
  readonly isMaxLevel: boolean;
}

/** Everything needed to score one reading log. */
export interface ReadingLogInput {
  /** Pages recorded by this log, already clamped to what is left of the book. */
  readonly pages: number;
  /** Pages the reader had already logged earlier on the same local day. */
  readonly pagesEarlierToday: number;
  readonly dailyGoal: number;
  /** Whether this log reaches the book's last page. */
  readonly finishesBook: boolean;
}

/** Result of scoring one reading log. Persisted alongside the log for auditing. */
export interface ReadingLogScore {
  /** Total XP for the log: the sum of the three parts below. */
  readonly xp: number;
  readonly pageXp: number;
  readonly goalBonusXp: number;
  readonly bookBonusXp: number;
  /** True when this log is the one that reached today's goal. */
  readonly goalReachedNow: boolean;
  /** True when today's goal is met, by this log or an earlier one. */
  readonly goalMetToday: boolean;
}

/** A book seen as the enemy it is in the game: its pages are its hit points. */
export interface BookProgress {
  readonly maxHp: number;
  readonly hp: number;
  /** 0..1 share of the book already read. */
  readonly ratio: number;
  readonly defeated: boolean;
}
