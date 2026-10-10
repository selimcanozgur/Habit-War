/**
 * Reading rules: what a logged page is worth, how a book takes damage, and how
 * consistency is measured.
 *
 * Every rule here serves one product decision (docs/product-v2.md): reading a
 * little every day must beat reading a lot once.
 */

import {
  BOOK_FINISHED_XP,
  CONSISTENCY_WINDOW_DAYS,
  DAILY_GOAL_BONUS_XP,
  DAILY_GOAL_OPTIONS,
  DAILY_PAGE_XP_CAP,
  GOAL_REVIEW_MIN_DAYS_MET,
  XP_PER_PAGE,
} from './balance.js';
import { daysBetween, type LocalDateKey } from './streaks.js';
import type { BookProgress, ReadingLogInput, ReadingLogScore } from './types.js';

function assertWholeNonNegative(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number >= 0, received: ${value}`);
  }
}

/**
 * Scores one reading log.
 *
 * Page XP stops at DAILY_PAGE_XP_CAP pages per day; the goal bonus is paid by the
 * log that crosses the goal, so logging the day in several small entries earns
 * exactly what one entry would.
 */
export function scoreReadingLog(input: ReadingLogInput): ReadingLogScore {
  const { pages, pagesEarlierToday, dailyGoal, finishesBook } = input;
  assertWholeNonNegative('pages', pages);
  assertWholeNonNegative('pagesEarlierToday', pagesEarlierToday);
  if (!Number.isInteger(dailyGoal) || dailyGoal < 1) {
    throw new RangeError(`dailyGoal must be a whole number >= 1, received: ${dailyGoal}`);
  }

  const pagesToday = pagesEarlierToday + pages;

  const xpPagesBefore = Math.min(pagesEarlierToday, DAILY_PAGE_XP_CAP);
  const xpPagesAfter = Math.min(pagesToday, DAILY_PAGE_XP_CAP);
  const pageXp = (xpPagesAfter - xpPagesBefore) * XP_PER_PAGE;

  const goalMetBefore = pagesEarlierToday >= dailyGoal;
  const goalMetToday = pagesToday >= dailyGoal;
  const goalReachedNow = goalMetToday && !goalMetBefore;
  const goalBonusXp = goalReachedNow ? DAILY_GOAL_BONUS_XP : 0;

  const bookBonusXp = finishesBook ? BOOK_FINISHED_XP : 0;

  return {
    xp: pageXp + goalBonusXp + bookBonusXp,
    pageXp,
    goalBonusXp,
    bookBonusXp,
    goalReachedNow,
    goalMetToday,
  };
}

/** The book as an enemy: pages left are its hit points. */
export function bookProgress(pagesRead: number, pageCount: number): BookProgress {
  assertWholeNonNegative('pagesRead', pagesRead);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new RangeError(`pageCount must be a whole number >= 1, received: ${pageCount}`);
  }
  const read = Math.min(pagesRead, pageCount);
  return {
    maxHp: pageCount,
    hp: pageCount - read,
    ratio: read / pageCount,
    defeated: read >= pageCount,
  };
}

/**
 * The pages a log may actually record: no more than what is left of the book.
 * A reader who types 30 with 12 pages to go has finished the book, not read past it.
 */
export function clampPagesToBook(pages: number, pagesRead: number, pageCount: number): number {
  return Math.max(0, Math.min(pages, pageCount - pagesRead));
}

/**
 * Distinct days with reading in the window ending `today`, inclusive.
 * The "30 günün 24'ü" figure: a softer measure of consistency than a streak.
 */
export function daysReadInWindow(
  readingDays: readonly LocalDateKey[],
  today: LocalDateKey,
  windowDays: number = CONSISTENCY_WINDOW_DAYS,
): number {
  const inWindow = new Set<LocalDateKey>();
  for (const day of readingDays) {
    const age = daysBetween(day, today);
    if (age >= 0 && age < windowDays) inWindow.add(day);
  }
  return inWindow.size;
}

/**
 * A smaller daily goal to offer, or null when the current one is working.
 *
 * A goal met on fewer than GOAL_REVIEW_MIN_DAYS_MET of the last review days is too
 * big, and a goal that is too big is how a habit dies. The next smaller option is
 * offered, never forced; at the smallest option there is nothing smaller to offer.
 */
export function suggestSmallerGoal(currentGoal: number, daysGoalMet: number): number | null {
  if (daysGoalMet >= GOAL_REVIEW_MIN_DAYS_MET) return null;
  const smaller = DAILY_GOAL_OPTIONS.filter((option) => option < currentGoal);
  return smaller.length > 0 ? (smaller[smaller.length - 1] as number) : null;
}
