/**
 * XP scoring engine — the mathematical core of the product.
 *
 * Pure: same input always yields the same output. It reads no clock, touches no
 * database, uses no randomness. That is the precondition for XP being auditable —
 * when a user asks "where did this XP come from?", the stored MultiplierBreakdown
 * must reproduce the number exactly.
 */

import {
  CLASS_BONUS,
  CLASS_STATS,
  DAILY_CATEGORY_CAP_MINUTES,
  DAILY_TOTAL_CAP_MINUTES,
  DIFFICULTY_MULTIPLIER,
  EVENT_MULTIPLIER_MAX,
  EVENT_MULTIPLIER_MIN,
  FOCUS_QUALITY_TIERS,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  OVER_CAP_EFFICIENCY,
  PRESTIGE_BONUS_CAP,
  PRESTIGE_BONUS_STEP,
  STREAK_DAILY_INCREMENT,
  STREAK_MULTIPLIER_CAP,
  TOTAL_MULTIPLIER_CAP,
  VERIFICATION_MULTIPLIER,
} from './balance.js';
import type { CharacterClass, MultiplierBreakdown, SessionInput, Stat, XpResult } from './types.js';

/** Clamps a value into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Streak multiplier: min(1 + days * 0.01, 1.5).
 *
 * KNOWN LIMIT: this saturates on day 50, after which sustaining a streak carries no
 * mechanical reward — the spec did not notice this. v1 keeps the formula for
 * simplicity, but streaks past 50 days need a badge or cosmetic reward. The fix is
 * NOT a higher multiplier: raising it widens the gap between veteran and new
 * accounts and breaks the league system.
 */
export function streakMultiplier(streakDays: number): number {
  const days = Math.max(0, Math.floor(streakDays));
  return Math.min(1 + days * STREAK_DAILY_INCREMENT, STREAK_MULTIPLIER_CAP);
}

/** Focus quality multiplier from the interruption count. Tiers live in balance.ts. */
export function focusQualityMultiplier(interruptions: number): number {
  const count = Math.max(0, Math.floor(interruptions));
  for (const [maxInterruptions, multiplier] of FOCUS_QUALITY_TIERS) {
    if (count <= maxInterruptions) return multiplier;
  }
  // Unreachable: the final tier's bound is Infinity. Kept for exhaustiveness.
  const last = FOCUS_QUALITY_TIERS[FOCUS_QUALITY_TIERS.length - 1];
  return last ? last[1] : 1;
}

/** Prestige (Ascend) XP bonus: +2% per ascension, capped at +10%. */
export function prestigeMultiplier(prestige: number): number {
  const count = Math.max(0, Math.floor(prestige));
  return 1 + Math.min(count * PRESTIGE_BONUS_STEP, PRESTIGE_BONUS_CAP);
}

/** Does this session's stat match one of the user's class stats? */
export function hasClassBonus(characterClass: CharacterClass | null, stat: Stat): boolean {
  if (characterClass === null) return false;
  const [first, second] = CLASS_STATS[characterClass];
  return first === stat || second === stat;
}

/**
 * Splits a session's minutes into full-rate and over-cap portions.
 *
 * Both the per-category cap and the global daily cap apply; whichever fills first
 * wins. The spec only described a category cap, which — at 7 categories x 120 min —
 * added up to exactly the 14-hour anomaly threshold, making that check dead code.
 */
export function splitByDailyCap(
  minutes: number,
  minutesTodayInCategory: number,
  minutesTodayTotal: number,
  categoryCap: number,
): { fullRate: number; overCap: number } {
  const categoryRemaining = Math.max(0, categoryCap - Math.max(0, minutesTodayInCategory));
  const totalRemaining = Math.max(0, DAILY_TOTAL_CAP_MINUTES - Math.max(0, minutesTodayTotal));
  const fullRate = Math.min(minutes, categoryRemaining, totalRemaining);
  return { fullRate, overCap: minutes - fullRate };
}

/**
 * Scores a single session into XP and stat points.
 *
 * @throws RangeError on invalid numeric input. Silently returning 0 would let a
 *   buggy client cost the user XP without anyone noticing.
 */
export function calculateSessionXp(input: SessionInput): XpResult {
  const {
    durationSec,
    category,
    stat,
    verification,
    streakDays,
    interruptions,
    characterClass,
    prestige,
    eventMultiplier,
    minutesTodayInCategory,
    minutesTodayTotal,
  } = input;

  if (!Number.isFinite(durationSec) || durationSec < 0) {
    throw new RangeError(`calculateSessionXp: durationSec must be >= 0, received: ${durationSec}`);
  }
  if (!Number.isFinite(eventMultiplier)) {
    throw new RangeError(
      `calculateSessionXp: eventMultiplier must be a finite number, received: ${eventMultiplier}`,
    );
  }

  // Reduce to whole minutes and clip to the single-session ceiling.
  const rawMinutes = Math.floor(durationSec / 60);
  const minutes = Math.min(rawMinutes, MAX_SESSION_MINUTES);

  const difficulty = DIFFICULTY_MULTIPLIER[category];
  const streak = streakMultiplier(streakDays);
  const focusQuality = focusQualityMultiplier(interruptions);
  const event = clamp(eventMultiplier, EVENT_MULTIPLIER_MIN, EVENT_MULTIPLIER_MAX);
  const verificationFactor = VERIFICATION_MULTIPLIER[verification];
  const classFactor = hasClassBonus(characterClass, stat) ? 1 + CLASS_BONUS : 1;
  const prestigeFactor = prestigeMultiplier(prestige);

  const { fullRate, overCap } = splitByDailyCap(
    minutes,
    minutesTodayInCategory,
    minutesTodayTotal,
    DAILY_CATEGORY_CAP_MINUTES[category],
  );

  // Base XP: 1 XP per full-rate minute, over-cap minutes at reduced efficiency.
  const baseXp = fullRate + overCap * OVER_CAP_EFFICIENCY;

  const rawTotal =
    difficulty * streak * focusQuality * event * verificationFactor * classFactor * prestigeFactor;
  const total = Math.min(rawTotal, TOTAL_MULTIPLIER_CAP);

  const breakdown: MultiplierBreakdown = {
    baseXp,
    fullRateMinutes: fullRate,
    overCapMinutes: overCap,
    difficulty,
    streak,
    focusQuality,
    event,
    verification: verificationFactor,
    characterClass: classFactor,
    prestige: prestigeFactor,
    rawTotal,
    total,
  };

  // Sessions below the minimum earn nothing — this kills "one-second session" spam.
  if (minutes < MIN_SESSION_MINUTES) {
    return { xp: 0, statXp: 0, stat, breakdown, hitDailyCap: false };
  }

  const xp = Math.floor(baseXp * total);
  return {
    xp,
    statXp: xp,
    stat,
    breakdown,
    hitDailyCap: overCap > 0,
  };
}
