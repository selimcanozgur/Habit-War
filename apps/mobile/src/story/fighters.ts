/**
 * Which habit to fight with, and how long the fight will take.
 *
 * Shared by every place that offers a fight — the first-run flow, Bugün's mission card,
 * the chapter page — so they all suggest the same habit and promise the same time.
 */

import { WEAKNESS_DAMAGE_MULTIPLIER, resolveStat, type Stat } from '@habitwar/domain';

import type { Habit } from '../api/sessions';

/** `YYYY-MM-DD` in the device's own timezone, which is what the API's dates mean. */
export function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface Fighter {
  readonly habit: Habit;
  /** Hits the monster's weakness: one and a half damage a second. */
  readonly weak: boolean;
  readonly doneToday: boolean;
  /** Damage a second with this habit. */
  readonly rate: number;
}

/**
 * The timed habits, best first: one not yet done today before one that is (the day's
 * list gets worked through), then the weakness before the rest. Count habits are fought
 * with quick taps on Bugün, not with a timer, so they are not offered here.
 */
export function rankFighters(habits: readonly Habit[], weakness: Stat | null, today: string): Fighter[] {
  return habits
    .filter((habit) => habit.kind !== 'COUNT')
    .map((habit) => {
      const weak = weakness !== null && resolveStat(habit.category, habit.stat) === weakness;
      return {
        habit,
        weak,
        doneToday: habit.lastCompletedDate === today,
        rate: weak ? WEAKNESS_DAMAGE_MULTIPLIER : 1,
      };
    })
    .sort((a, b) => Number(a.doneToday) - Number(b.doneToday) || Number(b.weak) - Number(a.weak));
}

/** "40 sn", "4 dk", "1 sa 36 dk" — how long `hp` lasts at `rate` damage a second. */
export function fightTimeLabel(hp: number, rate: number): string {
  const seconds = Math.ceil(hp / rate);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}
