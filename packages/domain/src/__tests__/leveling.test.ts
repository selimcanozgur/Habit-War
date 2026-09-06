import { describe, expect, it } from 'vitest';

import { LEVEL_BASE, MAX_LEVEL, REFERENCE_DAILY_XP } from '../balance.js';
import {
  cumulativeXpForLevel,
  daysToReachLevel,
  detectLevelUp,
  levelProgress,
  xpForLevel,
} from '../leveling.js';

describe('xpForLevel', () => {
  it('starts the curve at LEVEL_BASE', () => {
    expect(xpForLevel(1)).toBe(LEVEL_BASE);
  });

  it('is strictly increasing up to the cap', () => {
    for (let level = 1; level < MAX_LEVEL - 1; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });

  it('returns Infinity at and beyond max level', () => {
    expect(xpForLevel(MAX_LEVEL)).toBe(Number.POSITIVE_INFINITY);
    expect(xpForLevel(MAX_LEVEL + 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects levels below 1', () => {
    expect(() => xpForLevel(0)).toThrow(RangeError);
    expect(() => xpForLevel(-3)).toThrow(RangeError);
  });
});

describe('cumulativeXpForLevel', () => {
  it('costs nothing to be level 1', () => {
    expect(cumulativeXpForLevel(1)).toBe(0);
  });

  it('reaching level 2 costs exactly the first level requirement', () => {
    expect(cumulativeXpForLevel(2)).toBe(xpForLevel(1));
  });

  it('is the running sum of the per-level requirements', () => {
    let sum = 0;
    for (let level = 1; level < MAX_LEVEL; level++) {
      sum += xpForLevel(level);
      expect(cumulativeXpForLevel(level + 1)).toBe(sum);
    }
  });

  it('clamps past max level', () => {
    expect(cumulativeXpForLevel(MAX_LEVEL + 5)).toBe(cumulativeXpForLevel(MAX_LEVEL));
  });
});

describe('levelProgress', () => {
  it('places a brand new user at level 1 with an empty bar', () => {
    const progress = levelProgress(0);
    expect(progress.level).toBe(1);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.ratio).toBe(0);
    expect(progress.isMaxLevel).toBe(false);
  });

  it('round-trips every level boundary', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      expect(levelProgress(cumulativeXpForLevel(level)).level).toBe(level);
    }
  });

  it('stays one level below its own threshold', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(levelProgress(cumulativeXpForLevel(level) - 1).level).toBe(level - 1);
    }
  });

  it('reports a full bar and no next-level cost at max level', () => {
    const progress = levelProgress(cumulativeXpForLevel(MAX_LEVEL) + 100_000);
    expect(progress.level).toBe(MAX_LEVEL);
    expect(progress.isMaxLevel).toBe(true);
    expect(progress.ratio).toBe(1);
    expect(progress.xpForNextLevel).toBe(0);
  });

  it('keeps the ratio inside [0, 1] across the whole curve', () => {
    for (let xp = 0; xp <= cumulativeXpForLevel(MAX_LEVEL); xp += 137) {
      const { ratio } = levelProgress(xp);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });

  it('rejects negative XP', () => {
    expect(() => levelProgress(-1)).toThrow(RangeError);
  });
});

/**
 * These assertions are the reason the curve was refitted. The spec's own
 * `floor(100 * n^1.6)` put level 50 at ~979,000 XP — roughly 36 years at the spec's
 * own 60-minutes-per-day assumption, against a stated "~2.5 years". The curve is
 * now calibrated so the spec's TIME column is what actually holds.
 */
describe('curve calibration against the spec time targets', () => {
  it('reaches level 2 inside a single session', () => {
    expect(cumulativeXpForLevel(2)).toBeLessThanOrEqual(REFERENCE_DAILY_XP);
  });

  it('reaches level 11 in roughly a month', () => {
    const days = daysToReachLevel(11, REFERENCE_DAILY_XP);
    expect(days).toBeGreaterThan(20);
    expect(days).toBeLessThan(40);
  });

  it('reaches level 26 in roughly six months', () => {
    const days = daysToReachLevel(26, REFERENCE_DAILY_XP);
    expect(days).toBeGreaterThan(150);
    expect(days).toBeLessThan(240);
  });

  it('reaches max level in roughly two to three years', () => {
    const years = daysToReachLevel(MAX_LEVEL, REFERENCE_DAILY_XP) / 365;
    expect(years).toBeGreaterThan(1.8);
    expect(years).toBeLessThan(3.2);
  });
});

describe('detectLevelUp', () => {
  it('detects crossing a boundary', () => {
    const threshold = cumulativeXpForLevel(3);
    const result = detectLevelUp(threshold - 5, 10);
    expect(result.leveledUp).toBe(true);
    expect(result.fromLevel).toBe(2);
    expect(result.toLevel).toBe(3);
  });

  it('reports no level up when the award stays inside the level', () => {
    const result = detectLevelUp(cumulativeXpForLevel(3), 1);
    expect(result.leveledUp).toBe(false);
    expect(result.fromLevel).toBe(result.toLevel);
  });

  it('can cross several levels at once', () => {
    const result = detectLevelUp(0, cumulativeXpForLevel(5));
    expect(result.fromLevel).toBe(1);
    expect(result.toLevel).toBe(5);
  });

  it('treats a negative award as zero rather than de-levelling', () => {
    const result = detectLevelUp(cumulativeXpForLevel(4), -9999);
    expect(result.leveledUp).toBe(false);
    expect(result.toLevel).toBe(4);
  });
});
