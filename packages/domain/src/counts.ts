/**
 * Count-habit credit: how many whole minutes one log is worth.
 *
 * Credit is computed on the day's running total, not on the log alone, because the XP
 * engine counts whole minutes: five push-ups of fifty are 1.5 minutes, and scoring each
 * log by itself would round every small log down and lose the fractions for good. On
 * the running total, each log earns the whole minutes its share crosses, and the day
 * adds up to exactly COUNT_TARGET_MINUTES at the target.
 */

import { COUNT_TARGET_MINUTES } from './balance.js';

function creditedMinutes(total: number, target: number): number {
  if (target <= 0) return 0;
  const share = Math.min(Math.max(0, total), target) / target;
  return Math.floor(share * COUNT_TARGET_MINUTES);
}

/** Whole minutes of credit a log of `count` earns, given what was logged earlier today. */
export function countLogMinutes(loggedToday: number, count: number, target: number): number {
  return creditedMinutes(loggedToday + count, target) - creditedMinutes(loggedToday, target);
}
