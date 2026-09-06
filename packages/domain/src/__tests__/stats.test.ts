import { describe, expect, it } from 'vitest';

import { ALL_CATEGORIES, ALL_STATS, CATEGORY_ALLOWED_STATS, CLASS_UNLOCK_LEVEL } from '../balance.js';
import {
  addStatXp,
  deriveStatSheet,
  emptyStatSheet,
  isStatAllowedForCategory,
  rankStats,
  resolveStat,
  statPointsFromXp,
  suggestClass,
  totalStatPoints,
} from '../stats.js';
import type { StatSheet } from '../types.js';

function sheet(overrides: Partial<StatSheet> = {}): StatSheet {
  return { ...emptyStatSheet(), ...overrides };
}

describe('category / stat mapping', () => {
  it('gives every category a default stat', () => {
    for (const category of ALL_CATEGORIES) {
      expect(ALL_STATS).toContain(resolveStat(category));
    }
  });

  it("keeps every category's default inside its own allowed set", () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_ALLOWED_STATS[category]).toContain(resolveStat(category));
    }
  });

  it('lets a habit pin a legal alternative stat', () => {
    // Both running and weight training are FITNESS but feed different stats.
    expect(resolveStat('FITNESS', 'END')).toBe('END');
    expect(resolveStat('FITNESS', 'STR')).toBe('STR');
  });

  it('falls back to the default rather than trusting an illegal stat', () => {
    expect(resolveStat('FITNESS', 'INT')).toBe('STR');
    expect(resolveStat('STUDY', 'CHA')).toBe('INT');
  });

  it('falls back when the habit pins nothing', () => {
    expect(resolveStat('HEALTH', null)).toBe('WIS');
    expect(resolveStat('HEALTH')).toBe('WIS');
  });

  it('validates membership directly', () => {
    expect(isStatAllowedForCategory('CREATIVE', 'DEX')).toBe(true);
    expect(isStatAllowedForCategory('CREATIVE', 'STR')).toBe(false);
  });
});

describe('addStatXp', () => {
  it('adds points without mutating the original sheet', () => {
    const before = emptyStatSheet();
    const after = addStatXp(before, 'INT', 7);
    expect(after.INT).toBe(7);
    expect(before.INT).toBe(0);
  });

  it('ignores negative and fractional gains safely', () => {
    const base = sheet({ INT: 5 });
    expect(addStatXp(base, 'INT', -10).INT).toBe(5);
    expect(addStatXp(base, 'INT', 2.9).INT).toBe(7);
  });

  it('totals every stat', () => {
    expect(totalStatPoints(sheet({ STR: 3, INT: 4, WIS: 5 }))).toBe(12);
  });
});

describe('statPointsFromXp', () => {
  it('converts accumulated stat XP into displayed points', () => {
    expect(statPointsFromXp(0)).toBe(0);
    expect(statPointsFromXp(19)).toBe(0);
    expect(statPointsFromXp(20)).toBe(1);
    expect(statPointsFromXp(410)).toBe(20);
  });

  it('treats negative totals as zero', () => {
    expect(statPointsFromXp(-100)).toBe(0);
  });

  it('derives a whole sheet', () => {
    expect(deriveStatSheet(sheet({ INT: 410, WIS: 20, STR: 19 }))).toEqual({
      STR: 0,
      END: 0,
      INT: 20,
      WIS: 1,
      CHA: 0,
      DEX: 0,
    });
  });

  /**
   * Regression guard. Rounding each session to whole stat points discarded anything
   * worth less than one: a 15-minute meditation earns ~18 XP, so `floor(18 / 20)` is
   * zero and a daily meditator gained 1 WIS in a fortnight. Accumulating raw XP and
   * deriving the display value loses nothing.
   */
  it('credits short daily sessions that per-session rounding would discard', () => {
    const perSessionXp = 18;
    const days = 14;

    let accumulated = emptyStatSheet();
    for (let day = 0; day < days; day++) {
      accumulated = addStatXp(accumulated, 'WIS', perSessionXp);
    }

    const roundedPerSession = days * Math.floor(perSessionXp / 20);
    expect(roundedPerSession).toBe(0);
    expect(deriveStatSheet(accumulated).WIS).toBe(12);
  });
});

describe('rankStats', () => {
  it('orders highest first', () => {
    const ranked = rankStats(sheet({ INT: 10, WIS: 8, STR: 3 }));
    expect(ranked.slice(0, 3)).toEqual(['INT', 'WIS', 'STR']);
  });

  it('breaks ties deterministically so a suggestion never flickers', () => {
    const tied = sheet({ INT: 5, WIS: 5, STR: 5, END: 5, CHA: 5, DEX: 5 });
    expect(rankStats(tied)).toEqual(rankStats(tied));
    expect(rankStats(tied)).toEqual([...ALL_STATS]);
  });
});

describe('suggestClass', () => {
  it('stays silent below the unlock level', () => {
    expect(suggestClass(sheet({ INT: 100, WIS: 90 }), CLASS_UNLOCK_LEVEL - 1)).toBeNull();
  });

  it('stays silent for a user with no logged sessions', () => {
    expect(suggestClass(emptyStatSheet(), CLASS_UNLOCK_LEVEL + 5)).toBeNull();
  });

  it('matches an exact stat pair regardless of which is higher', () => {
    expect(suggestClass(sheet({ INT: 100, WIS: 90 }), CLASS_UNLOCK_LEVEL)).toBe('SCHOLAR');
    expect(suggestClass(sheet({ WIS: 100, INT: 90 }), CLASS_UNLOCK_LEVEL)).toBe('SCHOLAR');
  });

  it('maps the other defined pairs', () => {
    expect(suggestClass(sheet({ STR: 50, END: 40 }), CLASS_UNLOCK_LEVEL)).toBe('BERSERKER');
    expect(suggestClass(sheet({ CHA: 50, DEX: 40 }), CLASS_UNLOCK_LEVEL)).toBe('BARD');
    expect(suggestClass(sheet({ WIS: 50, END: 40 }), CLASS_UNLOCK_LEVEL)).toBe('MONK');
    expect(suggestClass(sheet({ END: 50, DEX: 40 }), CLASS_UNLOCK_LEVEL)).toBe('RANGER');
    expect(suggestClass(sheet({ DEX: 50, INT: 40 }), CLASS_UNLOCK_LEVEL)).toBe('ARTISAN');
  });

  /**
   * The spec listed four classes against six stats, so several stat distributions
   * had no class at all. Every non-empty sheet must resolve to something.
   */
  it('always resolves a class for a top pair the spec left unmapped', () => {
    // STR + CHA is not a class pair anywhere.
    expect(suggestClass(sheet({ STR: 100, CHA: 90 }), CLASS_UNLOCK_LEVEL)).not.toBeNull();
  });

  it('resolves a class for every possible top-two combination', () => {
    for (const first of ALL_STATS) {
      for (const second of ALL_STATS) {
        if (first === second) continue;
        const result = suggestClass(sheet({ [first]: 100, [second]: 90 }), CLASS_UNLOCK_LEVEL);
        expect(result).not.toBeNull();
      }
    }
  });
});
