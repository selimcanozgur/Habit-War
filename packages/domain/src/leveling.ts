/**
 * Level curve.
 *
 * The curve is expanded into a lookup table once at module load (51 entries), so
 * "total XP -> level" is both O(log n) and immune to floating-point drift. Calling
 * pow() on every request risks the same XP resolving to different levels in
 * different code paths.
 */

import { LEVEL_BASE, LEVEL_EXPONENT, LEVEL_TABLE_MAX, MAX_LEVEL } from './balance.js';
import type { LevelProgress } from './types.js';

/**
 * XP required to go from `level` to `level + 1`.
 * Returns Infinity at or beyond MAX_LEVEL — there is nothing further to reach.
 */
export function xpForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) {
    throw new RangeError(`xpForLevel: level must be >= 1, received: ${level}`);
  }
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return Math.floor(LEVEL_BASE * Math.pow(level, LEVEL_EXPONENT));
}

/**
 * CUMULATIVE[L] = total XP required to REACH level L.
 * CUMULATIVE[1] = 0 — everyone starts at level 1.
 */
const CUMULATIVE: readonly number[] = (() => {
  const table: number[] = [0, 0]; // index 0 unused
  for (let level = 2; level <= LEVEL_TABLE_MAX; level++) {
    const previous = table[level - 1] as number;
    table[level] = previous + Math.floor(LEVEL_BASE * Math.pow(level - 1, LEVEL_EXPONENT));
  }
  return table;
})();

/** Total XP required to reach `level`. Clamped at MAX_LEVEL. */
export function cumulativeXpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`cumulativeXpForLevel: level must be an integer >= 1, received: ${level}`);
  }
  if (level > MAX_LEVEL) return CUMULATIVE[MAX_LEVEL] as number;
  return CUMULATIVE[level] as number;
}

/**
 * Resolves the XP accumulated in the current prestige cycle into level progress.
 *
 * `cycleXp` is XP that RESETS on Ascend — it is not the user's lifetime total
 * (User.totalXp). Conflating the two would snap an ascended user straight back to
 * their old level.
 */
export function levelProgress(cycleXp: number): LevelProgress {
  if (!Number.isFinite(cycleXp) || cycleXp < 0) {
    throw new RangeError(`levelProgress: cycleXp must be >= 0, received: ${cycleXp}`);
  }
  const xp = Math.floor(cycleXp);

  // CUMULATIVE is strictly ascending; binary search the highest level xp covers.
  let low = 1;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((CUMULATIVE[mid] as number) <= xp) low = mid;
    else high = mid - 1;
  }

  const level = low;
  const isMaxLevel = level >= MAX_LEVEL;
  const xpIntoLevel = xp - (CUMULATIVE[level] as number);
  const xpForNextLevel = isMaxLevel ? 0 : xpForLevel(level);

  return {
    level,
    xpIntoLevel,
    xpForNextLevel,
    ratio: isMaxLevel ? 1 : Math.min(1, xpIntoLevel / xpForNextLevel),
    isMaxLevel,
  };
}

/** Whether an XP award crosses a level boundary. Drives the level-up animation. */
export function detectLevelUp(
  cycleXpBefore: number,
  xpGained: number,
): { leveledUp: boolean; fromLevel: number; toLevel: number } {
  const fromLevel = levelProgress(cycleXpBefore).level;
  const toLevel = levelProgress(cycleXpBefore + Math.max(0, xpGained)).level;
  return { leveledUp: toLevel > fromLevel, fromLevel, toLevel };
}

/**
 * Days to reach `level` at a given XP-per-day rate. Used by the balance simulator
 * in tools/balance and by the tests that lock the curve's time targets.
 */
export function daysToReachLevel(level: number, xpPerDay: number): number {
  if (xpPerDay <= 0) throw new RangeError(`daysToReachLevel: xpPerDay must be > 0`);
  return cumulativeXpForLevel(level) / xpPerDay;
}
