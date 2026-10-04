/**
 * Task-duel rules: which day a moment falls on, and what a finished duel pays.
 *
 * Pure, like the rest of this package, so the API's read path and the settlement job
 * cannot disagree about a result.
 */

import { DUEL_DRAW_XP, DUEL_PERFECT_XP, DUEL_WIN_XP } from './balance.js';

const MS_PER_DAY = 86_400_000;

/**
 * Zero-based duel day for an instant, or null outside the duel's window.
 *
 * Days are 24-hour slices counted from acceptance, not calendar days: both players
 * get the same number of equally long days whatever their timezones, and a duel
 * accepted at 23:50 does not lose its first day ten minutes later.
 */
export function duelDayIndex(startsAt: Date, endsAt: Date, at: Date): number | null {
  if (at < startsAt || at >= endsAt) return null;
  return Math.floor((at.getTime() - startsAt.getTime()) / MS_PER_DAY);
}

/** Number of days in a duel's window. */
export function duelLengthDays(startsAt: Date, endsAt: Date): number {
  return Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / MS_PER_DAY));
}

export interface DuelSideResult {
  /** Undisputed check-ins. */
  readonly score: number;
  readonly opponentScore: number;
  /** Days in the duel. */
  readonly days: number;
}

export interface DuelSettlementReward {
  readonly win: number;
  readonly draw: number;
  readonly perfect: number;
  readonly total: number;
}

/**
 * The bonus one side earns when the duel settles, on top of the per-day XP it was
 * already paid at check-in.
 *
 * Nothing is paid for doing nothing: a win needs a score above zero to beat, a draw
 * pays only when both sides scored, and "perfect" means every single day.
 */
export function duelSettlementReward({ score, opponentScore, days }: DuelSideResult): DuelSettlementReward {
  const win = score > opponentScore && score > 0 ? DUEL_WIN_XP : 0;
  const draw = score === opponentScore && score > 0 ? DUEL_DRAW_XP : 0;
  const perfect = days > 0 && score >= days ? DUEL_PERFECT_XP : 0;
  return { win, draw, perfect, total: win + draw + perfect };
}
