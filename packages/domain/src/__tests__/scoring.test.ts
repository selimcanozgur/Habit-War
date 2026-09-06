import { describe, expect, it } from 'vitest';

import {
  DAILY_CATEGORY_CAP_MINUTES,
  DAILY_TOTAL_CAP_MINUTES,
  MAX_SESSION_MINUTES,
  TOTAL_MULTIPLIER_CAP,
} from '../balance.js';
import {
  calculateSessionXp,
  focusQualityMultiplier,
  hasClassBonus,
  prestigeMultiplier,
  splitByDailyCap,
  streakMultiplier,
} from '../scoring.js';
import type { SessionInput } from '../types.js';

/** A neutral 30-minute study session; individual tests override what they exercise. */
function session(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    durationSec: 30 * 60,
    category: 'STUDY',
    stat: 'INT',
    verification: 'TIMER_ONLY',
    streakDays: 0,
    interruptions: 0,
    characterClass: null,
    prestige: 0,
    eventMultiplier: 1,
    minutesTodayInCategory: 0,
    minutesTodayTotal: 0,
    ...overrides,
  };
}

describe('streakMultiplier', () => {
  it('is neutral with no streak', () => {
    expect(streakMultiplier(0)).toBe(1);
  });

  it('grows 1% per day', () => {
    expect(streakMultiplier(10)).toBeCloseTo(1.1, 10);
  });

  it('saturates at the cap on day 50 and never exceeds it', () => {
    expect(streakMultiplier(50)).toBeCloseTo(1.5, 10);
    expect(streakMultiplier(365)).toBeCloseTo(1.5, 10);
  });

  it('treats negative input as no streak', () => {
    expect(streakMultiplier(-5)).toBe(1);
  });
});

describe('focusQualityMultiplier', () => {
  it('rewards an uninterrupted session', () => {
    expect(focusQualityMultiplier(0)).toBe(1.2);
  });

  it('is neutral for one or two interruptions', () => {
    expect(focusQualityMultiplier(1)).toBe(1);
    expect(focusQualityMultiplier(2)).toBe(1);
  });

  it('degrades in tiers and never drops below the floor', () => {
    expect(focusQualityMultiplier(5)).toBe(0.9);
    expect(focusQualityMultiplier(6)).toBe(0.75);
    expect(focusQualityMultiplier(1000)).toBe(0.75);
  });
});

describe('prestigeMultiplier', () => {
  it('is neutral before any ascension', () => {
    expect(prestigeMultiplier(0)).toBe(1);
  });

  it('grants 2% per ascension up to 10%', () => {
    expect(prestigeMultiplier(3)).toBeCloseTo(1.06, 10);
    expect(prestigeMultiplier(5)).toBeCloseTo(1.1, 10);
    expect(prestigeMultiplier(50)).toBeCloseTo(1.1, 10);
  });
});

describe('hasClassBonus', () => {
  it('matches either stat of the class pair', () => {
    expect(hasClassBonus('SCHOLAR', 'INT')).toBe(true);
    expect(hasClassBonus('SCHOLAR', 'WIS')).toBe(true);
  });

  it('does not match an unrelated stat', () => {
    expect(hasClassBonus('SCHOLAR', 'STR')).toBe(false);
  });

  it('is false when the user has no class', () => {
    expect(hasClassBonus(null, 'INT')).toBe(false);
  });
});

describe('splitByDailyCap', () => {
  it('gives full rate when nothing has been spent', () => {
    expect(splitByDailyCap(30, 0, 0, 180)).toEqual({ fullRate: 30, overCap: 0 });
  });

  it('splits at the category cap', () => {
    expect(splitByDailyCap(30, 170, 170, 180)).toEqual({ fullRate: 10, overCap: 20 });
  });

  it('splits at the global cap even when the category still has room', () => {
    const result = splitByDailyCap(30, 0, DAILY_TOTAL_CAP_MINUTES - 5, 180);
    expect(result).toEqual({ fullRate: 5, overCap: 25 });
  });

  it('gives no full-rate minutes once a cap is exhausted', () => {
    expect(splitByDailyCap(30, 180, 180, 180)).toEqual({ fullRate: 0, overCap: 30 });
  });

  /**
   * Regression guard for the spec's dead anomaly threshold: 7 categories x 120 min
   * was exactly 14 hours, which is where §4 Layer 3 started flagging. The global cap
   * must stay strictly below the sum of the category caps or it does nothing.
   */
  it('binds below the sum of every category cap', () => {
    const sumOfCategoryCaps = Object.values(DAILY_CATEGORY_CAP_MINUTES).reduce((a, b) => a + b, 0);
    expect(DAILY_TOTAL_CAP_MINUTES).toBeLessThan(sumOfCategoryCaps);
  });
});

describe('calculateSessionXp', () => {
  it('scores a plain uninterrupted study session', () => {
    // 30 min * (difficulty 1.15 * focus 1.2) = 30 * 1.38 = 41.4 -> 41
    const result = calculateSessionXp(session());
    expect(result.xp).toBe(41);
    expect(result.statXp).toBe(41);
    expect(result.stat).toBe('INT');
    expect(result.hitDailyCap).toBe(false);
  });

  it('records an auditable breakdown that reproduces the result', () => {
    const { xp, breakdown } = calculateSessionXp(session());
    expect(Math.floor(breakdown.baseXp * breakdown.total)).toBe(xp);
    expect(breakdown.fullRateMinutes).toBe(30);
    expect(breakdown.overCapMinutes).toBe(0);
  });

  it('discounts unverified manual entry to 30%', () => {
    const verified = calculateSessionXp(session());
    const manual = calculateSessionXp(session({ verification: 'MANUAL_ENTRY' }));
    expect(manual.breakdown.verification).toBe(0.3);
    expect(manual.xp).toBeLessThan(verified.xp);
  });

  it('does not pay a bonus for sharing health data', () => {
    const timer = calculateSessionXp(session());
    const health = calculateSessionXp(session({ verification: 'HEALTH_DATA' }));
    expect(health.xp).toBe(timer.xp);
  });

  it('keeps paying past the daily cap, at reduced efficiency', () => {
    const capped = calculateSessionXp(
      session({ minutesTodayInCategory: 170, minutesTodayTotal: 170 }),
    );
    expect(capped.hitDailyCap).toBe(true);
    expect(capped.breakdown.fullRateMinutes).toBe(10);
    expect(capped.breakdown.overCapMinutes).toBe(20);
    expect(capped.xp).toBeGreaterThan(0); // never zero: zeroing out feels punitive
    expect(capped.xp).toBeLessThan(calculateSessionXp(session()).xp);
  });

  it('clips a single session at the maximum creditable duration', () => {
    const tenHours = calculateSessionXp(session({ durationSec: 10 * 60 * 60 }));
    const atCap = calculateSessionXp(session({ durationSec: MAX_SESSION_MINUTES * 60 }));
    expect(tenHours.xp).toBe(atCap.xp);
  });

  it('pays nothing for a sub-minute session', () => {
    const result = calculateSessionXp(session({ durationSec: 45 }));
    expect(result.xp).toBe(0);
    expect(result.statXp).toBe(0);
  });

  it('applies the class bonus only to matching stats', () => {
    const plain = calculateSessionXp(session());
    const matched = calculateSessionXp(session({ characterClass: 'SCHOLAR' }));
    const unmatched = calculateSessionXp(session({ characterClass: 'BERSERKER' }));
    expect(matched.xp).toBeGreaterThan(plain.xp);
    expect(unmatched.xp).toBe(plain.xp);
  });

  it('clamps the event multiplier into its allowed range', () => {
    const absurd = calculateSessionXp(session({ eventMultiplier: 99 }));
    const legal = calculateSessionXp(session({ eventMultiplier: 2 }));
    expect(absurd.breakdown.event).toBe(2);
    expect(absurd.xp).toBe(legal.xp);

    const negative = calculateSessionXp(session({ eventMultiplier: -5 }));
    expect(negative.breakdown.event).toBe(1);
  });

  it('caps the compound multiplier no matter how the modifiers stack', () => {
    const stacked = calculateSessionXp(
      session({
        category: 'FITNESS',
        stat: 'STR',
        streakDays: 400,
        interruptions: 0,
        characterClass: 'BERSERKER',
        prestige: 5,
        eventMultiplier: 2,
      }),
    );
    expect(stacked.breakdown.rawTotal).toBeGreaterThan(TOTAL_MULTIPLIER_CAP);
    expect(stacked.breakdown.total).toBe(TOTAL_MULTIPLIER_CAP);
  });

  it('never lets any input produce a multiplier above the cap', () => {
    for (const category of ['FITNESS', 'STUDY', 'HEALTH'] as const) {
      for (const streakDays of [0, 25, 50, 900]) {
        for (const prestige of [0, 5, 99]) {
          const result = calculateSessionXp(
            session({ category, streakDays, prestige, eventMultiplier: 2, stat: 'INT' }),
          );
          expect(result.breakdown.total).toBeLessThanOrEqual(TOTAL_MULTIPLIER_CAP);
        }
      }
    }
  });

  it('rejects invalid numeric input instead of silently scoring zero', () => {
    expect(() => calculateSessionXp(session({ durationSec: -1 }))).toThrow(RangeError);
    expect(() => calculateSessionXp(session({ durationSec: Number.NaN }))).toThrow(RangeError);
    expect(() => calculateSessionXp(session({ eventMultiplier: Number.NaN }))).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const input = session({ streakDays: 12, interruptions: 3, prestige: 2 });
    expect(calculateSessionXp(input)).toEqual(calculateSessionXp(input));
  });

  /**
   * The economic guard rail: a maximally optimised account must not out-earn an
   * ordinary one by more than the cap allows. Without this the leaderboard stops
   * measuring effort and starts measuring modifier stacking.
   */
  it('bounds the spread between an optimised and an ordinary account', () => {
    const ordinary = calculateSessionXp(session({ category: 'HEALTH', stat: 'WIS' }));
    const optimised = calculateSessionXp(
      session({
        category: 'FITNESS',
        stat: 'STR',
        streakDays: 400,
        characterClass: 'BERSERKER',
        prestige: 5,
        eventMultiplier: 2,
      }),
    );
    expect(optimised.xp / ordinary.xp).toBeLessThan(4);
  });
});
