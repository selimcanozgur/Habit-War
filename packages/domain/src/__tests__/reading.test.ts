import { describe, expect, it } from 'vitest';

import {
  BOOK_FINISHED_XP,
  DAILY_GOAL_BONUS_XP,
  DAILY_GOAL_OPTIONS,
  DAILY_PAGE_XP_CAP,
  XP_PER_PAGE,
} from '../balance.js';
import {
  bookProgress,
  clampPagesToBook,
  daysReadInWindow,
  scoreReadingLog,
  suggestSmallerGoal,
} from '../reading.js';
import type { ReadingLogInput } from '../types.js';

function log(overrides: Partial<ReadingLogInput> = {}): ReadingLogInput {
  return { pages: 5, pagesEarlierToday: 0, dailyGoal: 10, finishesBook: false, ...overrides };
}

describe('scoreReadingLog', () => {
  it('pays XP per page', () => {
    const score = scoreReadingLog(log({ pages: 5 }));
    expect(score.pageXp).toBe(5 * XP_PER_PAGE);
    expect(score.goalBonusXp).toBe(0);
    expect(score.xp).toBe(score.pageXp);
  });

  it('pays the goal bonus to the log that reaches the goal', () => {
    const score = scoreReadingLog(log({ pages: 10, dailyGoal: 10 }));
    expect(score.goalReachedNow).toBe(true);
    expect(score.goalMetToday).toBe(true);
    expect(score.goalBonusXp).toBe(DAILY_GOAL_BONUS_XP);
  });

  it('pays the goal bonus once a day, not again on later logs', () => {
    const later = scoreReadingLog(log({ pages: 5, pagesEarlierToday: 10, dailyGoal: 10 }));
    expect(later.goalReachedNow).toBe(false);
    expect(later.goalMetToday).toBe(true);
    expect(later.goalBonusXp).toBe(0);
  });

  it('earns the same for a day split into several logs as for one log', () => {
    const single = scoreReadingLog(log({ pages: 12, dailyGoal: 10 }));
    const first = scoreReadingLog(log({ pages: 6, dailyGoal: 10 }));
    const second = scoreReadingLog(log({ pages: 6, pagesEarlierToday: 6, dailyGoal: 10 }));
    expect(first.xp + second.xp).toBe(single.xp);
  });

  it('stops paying page XP at the daily cap', () => {
    const score = scoreReadingLog(log({ pages: 50, pagesEarlierToday: DAILY_PAGE_XP_CAP - 10 }));
    expect(score.pageXp).toBe(10 * XP_PER_PAGE);
    const pastCap = scoreReadingLog(log({ pages: 50, pagesEarlierToday: DAILY_PAGE_XP_CAP }));
    expect(pastCap.pageXp).toBe(0);
  });

  it('pays the book bonus when the log finishes the book', () => {
    const score = scoreReadingLog(log({ pages: 3, finishesBook: true }));
    expect(score.bookBonusXp).toBe(BOOK_FINISHED_XP);
    expect(score.xp).toBe(score.pageXp + BOOK_FINISHED_XP);
  });

  /** The product's core promise, as a number. */
  it('makes a daily small goal outrun a one-off binge', () => {
    const daily = scoreReadingLog(log({ pages: 5, dailyGoal: 5 })).xp * 10;
    const binge = scoreReadingLog(log({ pages: 100, dailyGoal: 5 })).xp;
    expect(daily).toBeGreaterThan(binge);
  });

  it('rejects fractional or negative input', () => {
    expect(() => scoreReadingLog(log({ pages: -1 }))).toThrow(RangeError);
    expect(() => scoreReadingLog(log({ pages: 2.5 }))).toThrow(RangeError);
    expect(() => scoreReadingLog(log({ dailyGoal: 0 }))).toThrow(RangeError);
  });
});

describe('bookProgress', () => {
  it('treats unread pages as hit points', () => {
    expect(bookProgress(40, 200)).toEqual({ maxHp: 200, hp: 160, ratio: 0.2, defeated: false });
  });

  it('is defeated on the last page', () => {
    const progress = bookProgress(200, 200);
    expect(progress.hp).toBe(0);
    expect(progress.defeated).toBe(true);
  });

  it('never reports negative hit points', () => {
    expect(bookProgress(250, 200).hp).toBe(0);
  });

  it('rejects a book with no pages', () => {
    expect(() => bookProgress(0, 0)).toThrow(RangeError);
  });
});

describe('clampPagesToBook', () => {
  it('passes pages through while the book has room', () => {
    expect(clampPagesToBook(10, 50, 200)).toBe(10);
  });

  it('stops at the last page', () => {
    expect(clampPagesToBook(30, 188, 200)).toBe(12);
  });

  it('records nothing on a finished book', () => {
    expect(clampPagesToBook(5, 200, 200)).toBe(0);
  });
});

describe('daysReadInWindow', () => {
  it('counts distinct days inside the window', () => {
    const days = ['2026-10-10', '2026-10-10', '2026-10-09', '2026-10-01'];
    expect(daysReadInWindow(days, '2026-10-10')).toBe(3);
  });

  it('includes today and excludes days past the window', () => {
    expect(daysReadInWindow(['2026-10-10', '2026-09-11'], '2026-10-10', 30)).toBe(2);
    expect(daysReadInWindow(['2026-09-10'], '2026-10-10', 30)).toBe(0);
  });

  it('ignores days after today', () => {
    expect(daysReadInWindow(['2026-10-11'], '2026-10-10')).toBe(0);
  });
});

describe('suggestSmallerGoal', () => {
  it('suggests nothing while the goal is mostly met', () => {
    expect(suggestSmallerGoal(20, 4)).toBeNull();
  });

  it('suggests the next smaller option when the goal is mostly missed', () => {
    expect(suggestSmallerGoal(20, 1)).toBe(10);
    expect(suggestSmallerGoal(10, 3)).toBe(5);
  });

  it('has nothing to offer below the smallest option', () => {
    expect(suggestSmallerGoal(DAILY_GOAL_OPTIONS[0] as number, 0)).toBeNull();
  });
});
