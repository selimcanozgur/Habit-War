/**
 * Stat sheet and class derivation.
 *
 * Stats are what turn "minutes logged" into a character identity, so the rules for
 * how they accrue and how they resolve into a class need to be deterministic and
 * testable — the spec left both undefined.
 */

import {
  ALL_STATS,
  CATEGORY_ALLOWED_STATS,
  CATEGORY_DEFAULT_STAT,
  CLASS_STATS,
  CLASS_UNLOCK_LEVEL,
  STAT_POINT_DIVISOR,
  ALL_CLASSES,
} from './balance.js';
import type { Category, CharacterClass, Stat, StatSheet } from './types.js';

/** A stat sheet with every stat at zero. */
export function emptyStatSheet(): StatSheet {
  return { STR: 0, END: 0, INT: 0, WIS: 0, CHA: 0, DEX: 0 };
}

/** Whether `stat` is a legal choice for `category`. */
export function isStatAllowedForCategory(category: Category, stat: Stat): boolean {
  return CATEGORY_ALLOWED_STATS[category].includes(stat);
}

/**
 * Resolves which stat a habit feeds.
 *
 * A habit may pin its own stat (running and weight training are both FITNESS but
 * feed END and STR respectively). An illegal choice falls back to the category
 * default rather than throwing: a stale client should not be able to block a
 * session from being scored.
 */
export function resolveStat(category: Category, habitStat?: Stat | null): Stat {
  if (habitStat && isStatAllowedForCategory(category, habitStat)) return habitStat;
  return CATEGORY_DEFAULT_STAT[category];
}

/**
 * Returns a new XP sheet with `xp` added to `stat`. Never mutates the input.
 *
 * Stats accumulate raw XP; the number shown to the user is derived from it by
 * `statPointsFromXp`. Awarding rounded points per session instead would silently
 * discard every session worth less than one point — a 15-minute meditation earns
 * ~18 XP, so a daily meditator would have gained 1 WIS in a fortnight.
 */
export function addStatXp(sheet: StatSheet, stat: Stat, xp: number): StatSheet {
  const gain = Math.max(0, Math.floor(xp));
  return { ...sheet, [stat]: sheet[stat] + gain };
}

/** Displayed stat value for an accumulated stat-XP total. */
export function statPointsFromXp(statXp: number): number {
  return Math.floor(Math.max(0, statXp) / STAT_POINT_DIVISOR);
}

/** Converts a sheet of accumulated stat XP into the displayed stat sheet. */
export function deriveStatSheet(xpSheet: StatSheet): StatSheet {
  return {
    STR: statPointsFromXp(xpSheet.STR),
    END: statPointsFromXp(xpSheet.END),
    INT: statPointsFromXp(xpSheet.INT),
    WIS: statPointsFromXp(xpSheet.WIS),
    CHA: statPointsFromXp(xpSheet.CHA),
    DEX: statPointsFromXp(xpSheet.DEX),
  };
}

/**
 * Ranks stats highest-first. Ties break on ALL_STATS order so the result is stable
 * across calls and across machines — a class suggestion that flickers between two
 * equal stats would be a bad experience and an untestable one.
 */
export function rankStats(sheet: StatSheet): readonly Stat[] {
  return [...ALL_STATS].sort((a, b) => {
    const diff = sheet[b] - sheet[a];
    if (diff !== 0) return diff;
    return ALL_STATS.indexOf(a) - ALL_STATS.indexOf(b);
  });
}

/**
 * Suggests a class from the user's two highest stats (spec §3.3).
 *
 * Returns null below CLASS_UNLOCK_LEVEL, or when the sheet is entirely empty —
 * suggesting "Scholar" to someone with no logged sessions is noise.
 *
 * If the top two stats match a class pair exactly, that class wins. Otherwise the
 * class whose pair scores highest on this sheet wins; that keeps every possible
 * stat distribution mapped to some class, which the spec's four hand-written
 * pairings did not.
 */
export function suggestClass(sheet: StatSheet, level: number): CharacterClass | null {
  if (level < CLASS_UNLOCK_LEVEL) return null;
  if (ALL_STATS.every((stat) => sheet[stat] === 0)) return null;

  const [first, second] = rankStats(sheet);
  if (first === undefined || second === undefined) return null;

  const exact = ALL_CLASSES.find((candidate) => {
    const [a, b] = CLASS_STATS[candidate];
    return (a === first && b === second) || (a === second && b === first);
  });
  if (exact) return exact;

  // No exact pair: score each class by the sum of its two stats, ties by ALL_CLASSES order.
  let best: CharacterClass = ALL_CLASSES[0] as CharacterClass;
  let bestScore = -1;
  for (const candidate of ALL_CLASSES) {
    const [a, b] = CLASS_STATS[candidate];
    const score = sheet[a] + sheet[b];
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Total of all six stats — the single number a profile can lead with. */
export function totalStatPoints(sheet: StatSheet): number {
  return ALL_STATS.reduce((sum, stat) => sum + sheet[stat], 0);
}
