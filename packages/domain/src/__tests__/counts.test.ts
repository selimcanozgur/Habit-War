import { describe, expect, it } from 'vitest';

import { COUNT_TARGET_MINUTES } from '../balance.js';
import { countLogMinutes } from '../counts.js';

describe('countLogMinutes', () => {
  it('adds up to exactly the target credit, however the day is split', () => {
    let logged = 0;
    let minutes = 0;
    for (const count of [5, 5, 10, 3, 7, 20]) {
      minutes += countLogMinutes(logged, count, 50);
      logged += count;
    }
    expect(logged).toBe(50);
    expect(minutes).toBe(COUNT_TARGET_MINUTES);
  });

  it('keeps the fractions a small log would round away', () => {
    // 5 of 50 is 1.5 minutes: the first log earns 1, the second earns the other 2.
    expect(countLogMinutes(0, 5, 50)).toBe(1);
    expect(countLogMinutes(5, 5, 50)).toBe(2);
  });

  it('earns nothing past the target', () => {
    expect(countLogMinutes(50, 100, 50)).toBe(0);
    expect(countLogMinutes(40, 100, 50)).toBe(COUNT_TARGET_MINUTES - Math.floor((40 / 50) * COUNT_TARGET_MINUTES));
  });

  it('is zero for a broken target', () => {
    expect(countLogMinutes(0, 10, 0)).toBe(0);
  });
});
