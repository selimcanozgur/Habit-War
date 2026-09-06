import { describe, expect, it } from 'vitest';

import {
  advanceStreak,
  currentStreakAsOf,
  daysBetween,
  localDateKey,
  type StreakState,
} from '../streaks.js';

function state(overrides: Partial<StreakState> = {}): StreakState {
  return { current: 0, longest: 0, lastCompleted: null, ...overrides };
}

describe('localDateKey', () => {
  it('formats as a sortable YYYY-MM-DD key', () => {
    expect(localDateKey(new Date('2026-09-06T12:00:00Z'), 'UTC')).toBe('2026-09-06');
  });

  /**
   * The reason this module exists. At 21:30 UTC it is already tomorrow in Istanbul
   * and still today in UTC; comparing raw timestamps would break the streak of every
   * user who logs a late-night session.
   */
  it('resolves the local day, not the UTC day', () => {
    const lateNight = new Date('2026-09-06T21:30:00Z');
    expect(localDateKey(lateNight, 'UTC')).toBe('2026-09-06');
    expect(localDateKey(lateNight, 'Europe/Istanbul')).toBe('2026-09-07');
  });

  it('handles timezones behind UTC', () => {
    const earlyMorning = new Date('2026-09-06T02:00:00Z');
    expect(localDateKey(earlyMorning, 'America/New_York')).toBe('2026-09-05');
  });

  it('rejects an unknown timezone instead of silently falling back to UTC', () => {
    expect(() => localDateKey(new Date('2026-09-06T12:00:00Z'), 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-09-06', '2026-09-07')).toBe(1);
    expect(daysBetween('2026-09-06', '2026-09-06')).toBe(0);
    expect(daysBetween('2026-09-07', '2026-09-06')).toBe(-1);
  });

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  /** Turkey no longer observes DST, but users elsewhere do; the key math must not drift. */
  it('is unaffected by daylight saving transitions', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('rejects malformed keys', () => {
    expect(() => daysBetween('not-a-date', '2026-09-06')).toThrow(RangeError);
  });
});

describe('advanceStreak', () => {
  it('starts a streak at 1', () => {
    const result = advanceStreak(state(), '2026-09-06');
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
    expect(result.extended).toBe(true);
  });

  it('increments on a consecutive day', () => {
    const result = advanceStreak(
      state({ current: 4, longest: 9, lastCompleted: '2026-09-05' }),
      '2026-09-06',
    );
    expect(result.current).toBe(5);
    expect(result.longest).toBe(9);
    expect(result.extended).toBe(true);
  });

  it('does not double-count a second session on the same day', () => {
    const result = advanceStreak(
      state({ current: 4, longest: 4, lastCompleted: '2026-09-06' }),
      '2026-09-06',
    );
    expect(result.current).toBe(4);
    expect(result.extended).toBe(false);
  });

  it('raises the longest streak when the current one passes it', () => {
    const result = advanceStreak(
      state({ current: 9, longest: 9, lastCompleted: '2026-09-05' }),
      '2026-09-06',
    );
    expect(result.longest).toBe(10);
  });

  it('resets after a missed day with no freeze', () => {
    const result = advanceStreak(
      state({ current: 20, longest: 20, lastCompleted: '2026-09-04' }),
      '2026-09-06',
    );
    expect(result.current).toBe(1);
    expect(result.longest).toBe(20);
    expect(result.usedFreeze).toBe(false);
  });

  it('absorbs a missed day when a freeze is available', () => {
    const result = advanceStreak(
      state({ current: 20, longest: 20, lastCompleted: '2026-09-04' }),
      '2026-09-06',
      1,
    );
    expect(result.current).toBe(21);
    expect(result.usedFreeze).toBe(true);
  });

  it('does not stretch one freeze over two missed days', () => {
    const result = advanceStreak(
      state({ current: 20, longest: 20, lastCompleted: '2026-09-03' }),
      '2026-09-06',
      1,
    );
    expect(result.current).toBe(1);
    expect(result.usedFreeze).toBe(false);
  });

  it('leaves the streak alone for an out-of-order completion', () => {
    const before = state({ current: 7, longest: 7, lastCompleted: '2026-09-06' });
    const result = advanceStreak(before, '2026-09-04');
    expect(result.current).toBe(7);
    expect(result.lastCompleted).toBe('2026-09-06');
    expect(result.extended).toBe(false);
  });
});

describe('currentStreakAsOf', () => {
  it('is zero for a habit that was never completed', () => {
    expect(currentStreakAsOf(state(), '2026-09-06')).toBe(0);
  });

  it('keeps the streak alive on the same day and the day after', () => {
    const s = state({ current: 12, longest: 12, lastCompleted: '2026-09-05' });
    expect(currentStreakAsOf(s, '2026-09-05')).toBe(12);
    expect(currentStreakAsOf(s, '2026-09-06')).toBe(12);
  });

  /**
   * The stored counter is only valid until the day rolls over. Reading the raw
   * column would keep showing a dead streak as alive.
   */
  it('reports a lapsed streak as broken without needing a write', () => {
    const s = state({ current: 12, longest: 12, lastCompleted: '2026-09-04' });
    expect(currentStreakAsOf(s, '2026-09-07')).toBe(0);
  });

  it('holds the streak while a freeze can still cover the gap', () => {
    const s = state({ current: 12, longest: 12, lastCompleted: '2026-09-04' });
    expect(currentStreakAsOf(s, '2026-09-06', 1)).toBe(12);
    expect(currentStreakAsOf(s, '2026-09-06', 0)).toBe(0);
  });
});
