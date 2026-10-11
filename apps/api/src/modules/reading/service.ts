/**
 * Reading: logging pages, and the "today" summary the main screen is built from.
 *
 * The scoring rules themselves live in @habitwar/domain; this service owns only what
 * needs the database — what was read earlier today, the book's remaining pages, and
 * writing the log, the ledger row, the book and the user in one transaction.
 */

import {
  advanceStreak,
  clampPagesToBook,
  CONSISTENCY_WINDOW_DAYS,
  currentStreakAsOf,
  daysBetween,
  daysReadInWindow,
  detectLevelUp,
  estimateDaysToFinish,
  GOAL_REVIEW_DAYS,
  levelProgress,
  localDateKey,
  PACE_WINDOW_DAYS,
  pagesPerDayToFinish,
  phaseCrossed,
  scoreReadingLog,
  STREAK_GRACE_DAYS,
  suggestSmallerGoal,
  type LevelProgress,
  type ReadingLogScore,
} from '@habitwar/domain';
import { Prisma, type Book, type PrismaClient } from '@prisma/client';

import { addDays } from '../../lib/calendar.js';
import { conflict, notFound } from '../../lib/errors.js';
import { toBookView, type BookForecast, type BookView } from '../books/view.js';

export interface ReadingServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
}

export interface LogPagesInput {
  readonly userId: string;
  readonly bookId: string;
  readonly pages: number;
  readonly clientRequestId: string;
  readonly note?: string | null;
}

export interface LogPagesResult {
  readonly logId: string;
  /** Pages actually recorded, after clamping to what was left of the book. */
  readonly pages: number;
  readonly score: ReadingLogScore;
  readonly book: BookView;
  readonly level: {
    readonly leveledUp: boolean;
    readonly fromLevel: number;
    readonly toLevel: number;
    readonly progress: LevelProgress;
  };
  readonly streak: { readonly current: number; readonly longest: number };
  /** The BOOK_PHASES threshold this log crossed (0.25, 0.5, 0.75), or null. */
  readonly phase: number | null;
  /** True when this answers a retried request rather than logging anew. */
  readonly replayed: boolean;
}

export interface TodaySummary {
  readonly date: string;
  readonly dailyGoal: number;
  readonly pagesToday: number;
  readonly goalMet: boolean;
  readonly streak: { readonly current: number; readonly longest: number };
  /** Distinct days with reading in the last CONSISTENCY_WINDOW_DAYS days. */
  readonly daysRead: number;
  readonly windowDays: number;
  /** A smaller goal to offer, or null when the current one is working. */
  readonly suggestedGoal: number | null;
  readonly books: readonly (BookView & { readonly forecast: BookForecast })[];
}

/** One book in depth: the victory card for a finished book, progress for a current one. */
export interface BookDetail {
  readonly book: BookView;
  readonly stats: {
    /** Distinct days with reading on this book. */
    readonly daysRead: number;
    /** Local day of the first log, or null before any reading. */
    readonly startedOn: string | null;
    /** Calendar days from the first log to the finish (or today), inclusive. */
    readonly daysSpent: number;
    /** pagesRead / daysSpent, rounded. */
    readonly pagesPerDay: number;
  };
  /** The reader's notes, oldest first. */
  readonly notes: readonly { readonly date: string; readonly pages: number; readonly note: string }[];
  /** Null for a finished book. */
  readonly forecast: BookForecast | null;
}

export interface CalendarDay {
  readonly date: string;
  readonly pages: number;
}

export class ReadingService {
  readonly #prisma: PrismaClient;
  readonly #now: () => Date;

  constructor(deps: ReadingServiceDeps) {
    this.#prisma = deps.prisma;
    this.#now = deps.now;
  }

  /**
   * Records pages read against a book.
   *
   * Idempotent on `clientRequestId`: a retry returns the original result instead of
   * logging, and paying, the pages twice.
   */
  async logPages(input: LogPagesInput): Promise<LogPagesResult> {
    const existing = await this.#prisma.readingLog.findUnique({
      where: { clientRequestId: input.clientRequestId },
    });
    if (existing) return this.#replay(input.userId, existing);

    try {
      return await this.#prisma.$transaction((tx) => this.#write(tx, input));
    } catch (error) {
      // Two copies of the same request raced past the lookup above; the loser answers
      // with the winner's result.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.#prisma.readingLog.findUnique({
          where: { clientRequestId: input.clientRequestId },
        });
        if (winner) return this.#replay(input.userId, winner);
      }
      throw error;
    }
  }

  async #write(tx: Prisma.TransactionClient, input: LogPagesInput): Promise<LogPagesResult> {
    // Serialises a user's logs. Two logs racing on the same day would each read the
    // other's pages as not yet written, and both would pay the daily goal bonus.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    const book = await tx.book.findFirst({ where: { id: input.bookId, userId: input.userId } });
    if (!book) throw notFound('Book not found');
    if (book.status === 'FINISHED') throw conflict('This book is already finished');

    const now = this.#now();
    const today = localDateKey(now, user.timezone);

    const earlier = await tx.readingLog.aggregate({
      where: { userId: user.id, dateKey: today },
      _sum: { pages: true },
    });
    const pagesEarlierToday = earlier._sum.pages ?? 0;

    const pages = clampPagesToBook(input.pages, book.pagesRead, book.pageCount);
    const finishesBook = book.pagesRead + pages >= book.pageCount;
    const score = scoreReadingLog({
      pages,
      pagesEarlierToday,
      dailyGoal: user.dailyGoal,
      finishesBook,
    });

    const streak = advanceStreak(
      { current: user.currentStreak, longest: user.longestStreak, lastCompleted: user.lastReadDate },
      today,
      STREAK_GRACE_DAYS,
    );
    const xp = user.xp + score.xp;
    const levelUp = detectLevelUp(user.xp, score.xp);

    const log = await tx.readingLog.create({
      data: {
        userId: user.id,
        bookId: book.id,
        clientRequestId: input.clientRequestId,
        pages,
        dateKey: today,
        note: input.note ?? null,
        xpAwarded: score.xp,
        score: score as unknown as Prisma.InputJsonValue,
      },
    });

    if (score.xp > 0) {
      await tx.xpLedger.create({
        data: { userId: user.id, amount: score.xp, reason: 'READING_LOG', readingLogId: log.id },
      });
    }

    const updatedBook = await tx.book.update({
      where: { id: book.id },
      data: {
        pagesRead: { increment: pages },
        ...(finishesBook ? { status: 'FINISHED' as const, finishedAt: now } : {}),
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        xp,
        level: levelUp.toLevel,
        currentStreak: streak.current,
        longestStreak: streak.longest,
        lastReadDate: streak.lastCompleted,
      },
    });

    return {
      logId: log.id,
      pages,
      score,
      book: toBookView(updatedBook),
      level: { ...levelUp, progress: levelProgress(xp) },
      streak: { current: streak.current, longest: streak.longest },
      phase: phaseCrossed(book.pagesRead, book.pagesRead + pages, book.pageCount),
      replayed: false,
    };
  }

  /** The original result of an already-logged request, rebuilt from what was stored. */
  async #replay(
    userId: string,
    log: { id: string; userId: string; bookId: string; pages: number; score: Prisma.JsonValue },
  ): Promise<LogPagesResult> {
    if (log.userId !== userId) {
      // Same key, different account: a client bug or a guessed key. Never echo
      // another user's log back.
      throw conflict('clientRequestId has already been used');
    }
    const [user, book] = await Promise.all([
      this.#prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.#prisma.book.findUniqueOrThrow({ where: { id: log.bookId } }),
    ]);
    const score = log.score as unknown as ReadingLogScore;
    return {
      logId: log.id,
      pages: log.pages,
      score,
      book: toBookView(book),
      level: { ...detectLevelUp(user.xp - score.xp, score.xp), progress: levelProgress(user.xp) },
      streak: { current: user.currentStreak, longest: user.longestStreak },
      // The moment belonged to the original request; a retry does not celebrate twice.
      phase: null,
      replayed: true,
    };
  }

  /** Everything the main screen shows, in one read. */
  async today(userId: string): Promise<TodaySummary> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = this.#now();
    const today = localDateKey(now, user.timezone);
    const windowStart = addDays(today, -(CONSISTENCY_WINDOW_DAYS - 1));

    const [days, books] = await Promise.all([
      this.#prisma.readingLog.groupBy({
        by: ['dateKey'],
        where: { userId, dateKey: { gte: windowStart } },
        _sum: { pages: true },
      }),
      this.#prisma.book.findMany({
        where: { userId, status: 'READING' },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const pagesByDay = new Map(days.map((day) => [day.dateKey, day._sum.pages ?? 0]));
    const pagesToday = pagesByDay.get(today) ?? 0;

    return {
      date: today,
      dailyGoal: user.dailyGoal,
      pagesToday,
      goalMet: pagesToday >= user.dailyGoal,
      streak: {
        current: currentStreakAsOf(
          { current: user.currentStreak, longest: user.longestStreak, lastCompleted: user.lastReadDate },
          today,
          STREAK_GRACE_DAYS,
        ),
        longest: user.longestStreak,
      },
      daysRead: daysReadInWindow([...pagesByDay.keys()], today),
      windowDays: CONSISTENCY_WINDOW_DAYS,
      suggestedGoal: this.#goalSuggestion(user, today, pagesByDay, now),
      books: await this.#withForecasts(books, today),
    };
  }

  /** One book in depth: its numbers, the reader's notes, and the finish estimate. */
  async bookDetail(userId: string, bookId: string): Promise<BookDetail> {
    const [user, book] = await Promise.all([
      this.#prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.#prisma.book.findFirst({ where: { id: bookId, userId } }),
    ]);
    if (!book) throw notFound('Book not found');

    const today = localDateKey(this.#now(), user.timezone);
    const logs = await this.#prisma.readingLog.findMany({
      where: { bookId: book.id },
      orderBy: { createdAt: 'asc' },
      select: { dateKey: true, pages: true, note: true },
    });

    const startedOn = logs[0]?.dateKey ?? null;
    const endedOn = book.finishedAt ? localDateKey(book.finishedAt, user.timezone) : today;
    const daysSpent = startedOn ? daysBetween(startedOn, endedOn) + 1 : 0;

    return {
      book: toBookView(book),
      stats: {
        daysRead: new Set(logs.map((log) => log.dateKey)).size,
        startedOn,
        daysSpent,
        pagesPerDay: daysSpent > 0 ? Math.round(book.pagesRead / daysSpent) : 0,
      },
      notes: logs.flatMap((log) => (log.note ? [{ date: log.dateKey, pages: log.pages, note: log.note }] : [])),
      forecast: book.status === 'READING' ? ((await this.#withForecasts([book], today))[0]?.forecast ?? null) : null,
    };
  }

  /** Pages read per local day over the last `days` days, oldest first. Days with no reading are omitted. */
  async calendar(
    userId: string,
    days: number,
  ): Promise<{ from: string; to: string; dailyGoal: number; days: CalendarDay[] }> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const to = localDateKey(this.#now(), user.timezone);
    const from = addDays(to, -(days - 1));
    const rows = await this.#prisma.readingLog.groupBy({
      by: ['dateKey'],
      where: { userId, dateKey: { gte: from, lte: to } },
      _sum: { pages: true },
      orderBy: { dateKey: 'asc' },
    });
    return {
      from,
      to,
      dailyGoal: user.dailyGoal,
      days: rows.map((row) => ({ date: row.dateKey, pages: row._sum.pages ?? 0 })),
    };
  }

  /**
   * Attaches the finish estimate to each book.
   *
   * Pace is the pages read on the book over the last PACE_WINDOW_DAYS days — or since
   * its first log, for a book started inside the window, so a book begun three days
   * ago is not judged as if it had sat untouched for the other eleven.
   */
  async #withForecasts(books: readonly Book[], today: string) {
    const ids = books.map((book) => book.id);
    const windowStart = addDays(today, -(PACE_WINDOW_DAYS - 1));
    const [recent, firsts] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            this.#prisma.readingLog.groupBy({
              by: ['bookId'],
              where: { bookId: { in: ids }, dateKey: { gte: windowStart } },
              _sum: { pages: true },
            }),
            this.#prisma.readingLog.groupBy({
              by: ['bookId'],
              where: { bookId: { in: ids } },
              _min: { dateKey: true },
            }),
          ]);
    const recentPages = new Map(recent.map((row) => [row.bookId, row._sum.pages ?? 0]));
    const firstDay = new Map(firsts.map((row) => [row.bookId, row._min.dateKey]));

    const [year, month, day] = today.split('-').map(Number) as [number, number, number];
    const daysLeftInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1;

    return books.map((book) => {
      const first = firstDay.get(book.id);
      const span = first ? Math.min(PACE_WINDOW_DAYS, daysBetween(first, today) + 1) : PACE_WINDOW_DAYS;
      const pace = (recentPages.get(book.id) ?? 0) / span;
      const pagesLeft = book.pageCount - book.pagesRead;
      return {
        ...toBookView(book),
        forecast: {
          daysToFinish: estimateDaysToFinish(pagesLeft, pace),
          pagesPerDayForMonthEnd: pagesPerDayToFinish(pagesLeft, daysLeftInMonth),
          daysLeftInMonth,
        },
      };
    });
  }

  /**
   * Judges the goal over the last GOAL_REVIEW_DAYS completed days — today is still
   * in progress and must not count against it. A goal younger than the review window
   * has not had a fair chance yet, so nothing is suggested for it.
   */
  #goalSuggestion(
    user: { dailyGoal: number; goalSetAt: Date },
    today: string,
    pagesByDay: ReadonlyMap<string, number>,
    now: Date,
  ): number | null {
    const goalAgeDays = (now.getTime() - user.goalSetAt.getTime()) / 86_400_000;
    if (goalAgeDays < GOAL_REVIEW_DAYS) return null;

    let daysMet = 0;
    for (let offset = 1; offset <= GOAL_REVIEW_DAYS; offset++) {
      if ((pagesByDay.get(addDays(today, -offset)) ?? 0) >= user.dailyGoal) daysMet++;
    }
    return suggestSmallerGoal(user.dailyGoal, daysMet);
  }
}
