/**
 * The signed-in user's own account: profile, settings, first-run flow, push tokens,
 * and the KVKK rights (export and erasure).
 */

import {
  CONSISTENCY_WINDOW_DAYS,
  currentStreakAsOf,
  levelProgress,
  localDateKey,
  STREAK_GRACE_DAYS,
  type LevelProgress,
} from '@habitwar/domain';
import type { DevicePlatform, Locale, PrismaClient, User } from '@prisma/client';

import { addDays, startOfLocalDay } from '../../lib/calendar.js';
import { conflict } from '../../lib/errors.js';
import { definedOnly } from '../../lib/objects.js';
import { softDeleteUser } from '../users/service.js';
import { ACCOUNT_ERASURE_RETENTION_DAYS } from '../../jobs/constants.js';

import type { OnboardingInput, UpdateMeInput } from './schemas.js';

export interface MeServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
}

export interface Profile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly timezone: string;
  readonly locale: Locale;
  readonly onboarded: boolean;
  readonly dailyGoal: number;
  readonly reminderTime: string | null;
  readonly xp: number;
  readonly progress: LevelProgress;
  readonly streak: { readonly current: number; readonly longest: number };
  readonly yearly: {
    readonly year: number;
    readonly goal: number | null;
    /** Books finished since 1 January in the user's timezone. */
    readonly finished: number;
  };
  readonly stats: {
    readonly totalPages: number;
    readonly booksFinished: number;
    readonly daysRead: number;
    readonly windowDays: number;
  };
  readonly createdAt: Date;
}

export class MeService {
  readonly #prisma: PrismaClient;
  readonly #now: () => Date;

  constructor(deps: MeServiceDeps) {
    this.#prisma = deps.prisma;
    this.#now = deps.now;
  }

  async profile(userId: string): Promise<Profile> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const today = localDateKey(this.#now(), user.timezone);

    const year = Number(today.slice(0, 4));
    const yearStart = startOfLocalDay(`${year}-01-01`, user.timezone);

    const [pages, booksFinished, finishedThisYear, days] = await Promise.all([
      this.#prisma.readingLog.aggregate({ where: { userId }, _sum: { pages: true } }),
      this.#prisma.book.count({ where: { userId, status: 'FINISHED' } }),
      this.#prisma.book.count({ where: { userId, status: 'FINISHED', finishedAt: { gte: yearStart } } }),
      this.#prisma.readingLog.groupBy({
        by: ['dateKey'],
        where: { userId, dateKey: { gte: addDays(today, -(CONSISTENCY_WINDOW_DAYS - 1)) } },
      }),
    ]);

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      locale: user.locale,
      onboarded: user.onboardedAt !== null,
      dailyGoal: user.dailyGoal,
      reminderTime: user.reminderTime,
      xp: user.xp,
      progress: levelProgress(user.xp),
      streak: {
        current: currentStreakAsOf(
          { current: user.currentStreak, longest: user.longestStreak, lastCompleted: user.lastReadDate },
          today,
          STREAK_GRACE_DAYS,
        ),
        longest: user.longestStreak,
      },
      yearly: { year, goal: user.yearlyBookGoal, finished: finishedThisYear },
      stats: {
        totalPages: pages._sum.pages ?? 0,
        booksFinished,
        daysRead: days.length,
        windowDays: CONSISTENCY_WINDOW_DAYS,
      },
      createdAt: user.createdAt,
    };
  }

  async update(userId: string, input: UpdateMeInput): Promise<Profile> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.#prisma.user.update({
      where: { id: userId },
      data: {
        ...definedOnly({
          displayName: input.displayName,
          timezone: input.timezone,
          locale: input.locale,
          dailyGoal: input.dailyGoal,
        }),
        ...(input.reminderTime !== undefined ? { reminderTime: input.reminderTime } : {}),
        ...(input.yearlyBookGoal !== undefined ? { yearlyBookGoal: input.yearlyBookGoal } : {}),
        ...this.#goalClock(user, input.dailyGoal),
      },
    });
    return this.profile(userId);
  }

  /** Finishes the first-run flow. Runs once; the settings screen handles later changes. */
  async completeOnboarding(userId: string, input: OnboardingInput): Promise<Profile> {
    const user = await this.#prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.onboardedAt) throw conflict('Onboarding is already complete');

    await this.#prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...definedOnly({ displayName: input.displayName }),
          timezone: input.timezone,
          locale: input.locale,
          dailyGoal: input.dailyGoal,
          goalSetAt: this.#now(),
          reminderTime: input.reminderTime,
          onboardedAt: this.#now(),
        },
      });
      if (input.firstBook) {
        await tx.book.create({
          data: {
            userId,
            title: input.firstBook.title,
            author: input.firstBook.author ?? null,
            pageCount: input.firstBook.pageCount,
          },
        });
      }
    });
    return this.profile(userId);
  }

  /**
   * Registers a device for reminders. A token already held by another account moves
   * to this one: the device now belongs to whoever signed in last.
   */
  async registerPushToken(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.#prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, disabledAt: null },
    });
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.#prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Everything stored about the user (KVKK m.11 portability). */
  async exportData(userId: string): Promise<unknown> {
    const user = await this.#prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        books: { orderBy: { createdAt: 'asc' } },
        readingLogs: { orderBy: { createdAt: 'asc' } },
        xpLedger: { orderBy: { createdAt: 'asc' } },
        authIdentities: { select: { provider: true, email: true, createdAt: true } },
        authSessions: {
          select: { userAgent: true, ipAddress: true, createdAt: true, expiresAt: true, revokedAt: true },
        },
      },
    });
    const { passwordHash: _passwordHash, ...rest } = user;
    return { exportedAt: this.#now().toISOString(), user: rest };
  }

  /**
   * Erasure (KVKK m.7). The account is dead to the user immediately; the scheduled
   * purge deletes the row after the retention window.
   */
  async requestDeletion(userId: string): Promise<{ deletedAt: Date; purgeEligibleAt: Date }> {
    const user = await softDeleteUser(this.#prisma, userId);
    const deletedAt = user?.deletedAt ?? this.#now();
    const purgeEligibleAt = new Date(
      deletedAt.getTime() + ACCOUNT_ERASURE_RETENTION_DAYS * 86_400_000,
    );
    return { deletedAt, purgeEligibleAt };
  }

  /** A changed goal restarts the review clock; an unchanged one keeps its history. */
  #goalClock(user: User, dailyGoal: number | undefined): { goalSetAt?: Date } {
    return dailyGoal !== undefined && dailyGoal !== user.dailyGoal ? { goalSetAt: this.#now() } : {};
  }
}
