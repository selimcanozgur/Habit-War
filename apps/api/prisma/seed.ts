/**
 * Development seed.
 *
 * Creates one user with a spread of habits and a fortnight of session history, so
 * the XP curve, streaks and daily caps can be exercised against realistic data
 * rather than a single hand-made row.
 *
 * Idempotent: re-running replaces the seeded user's data instead of duplicating it.
 */

import { PrismaClient } from '@prisma/client';
import {
  calculateSessionXp,
  deriveStatSheet,
  localDateKey,
  levelProgress,
  resolveStat,
  suggestClass,
  type Category,
  type Stat,
} from '@habitwar/domain';

const prisma = new PrismaClient();

const SEED_CLERK_ID = 'seed_selimcan';
const TIMEZONE = 'Europe/Istanbul';
const DAYS_OF_HISTORY = 14;

interface SeedHabit {
  readonly name: string;
  readonly category: Category;
  readonly stat: Stat;
  readonly targetMinutes: number;
  readonly colorHex: string;
  /** Minutes logged per day; 0 means the habit was skipped that day. */
  readonly dailyMinutes: readonly number[];
}

/**
 * Deliberately uneven history: one perfect streak, one broken streak, one habit that
 * blows past its daily cap. Seeded data that is too tidy hides exactly the bugs the
 * cap and streak logic are there to prevent.
 */
const HABITS: readonly SeedHabit[] = [
  {
    name: 'Kitap okuma',
    category: 'STUDY',
    stat: 'INT',
    targetMinutes: 30,
    colorHex: '#6366F1',
    dailyMinutes: [30, 45, 30, 30, 60, 30, 30, 45, 30, 30, 30, 40, 30, 35],
  },
  {
    name: 'Ağırlık antrenmanı',
    category: 'FITNESS',
    stat: 'STR',
    targetMinutes: 60,
    colorHex: '#EF4444',
    dailyMinutes: [60, 0, 60, 0, 60, 0, 0, 60, 0, 60, 0, 60, 0, 55],
  },
  {
    name: 'Meditasyon',
    category: 'MINDFULNESS',
    stat: 'WIS',
    targetMinutes: 15,
    colorHex: '#10B981',
    dailyMinutes: [15, 15, 15, 0, 0, 15, 15, 15, 15, 15, 0, 15, 15, 20],
  },
  {
    name: 'Gitar pratiği',
    category: 'SKILL',
    stat: 'DEX',
    targetMinutes: 45,
    colorHex: '#F59E0B',
    // Day 5 is a 200-minute binge: exceeds the 150-minute SKILL cap on purpose.
    dailyMinutes: [45, 45, 0, 45, 200, 45, 0, 45, 45, 0, 45, 45, 45, 50],
  },
];

const STAT_COLUMN: Readonly<Record<Stat, keyof SeedTotals>> = {
  STR: 'strengthXp',
  END: 'enduranceXp',
  INT: 'intelligenceXp',
  WIS: 'wisdomXp',
  CHA: 'charismaXp',
  DEX: 'dexterityXp',
};

interface SeedTotals {
  strengthXp: number;
  enduranceXp: number;
  intelligenceXp: number;
  wisdomXp: number;
  charismaXp: number;
  dexterityXp: number;
}

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { clerkId: SEED_CLERK_ID } });
  if (existing) {
    // Cascades clear habits, sessions, ledger and usage.
    await prisma.user.delete({ where: { id: existing.id } });
    console.log('Removed previous seed user');
  }

  const user = await prisma.user.create({
    data: {
      clerkId: SEED_CLERK_ID,
      username: 'selimcan',
      displayName: 'Selimcan',
      email: 'selimcan@example.com',
      bio: 'Gerçek hayattaki seviyemi yükseltiyorum.',
      timezone: TIMEZONE,
    },
  });

  const habits = await Promise.all(
    HABITS.map((habit) =>
      prisma.habit.create({
        data: {
          userId: user.id,
          name: habit.name,
          category: habit.category,
          stat: habit.stat,
          targetMinutes: habit.targetMinutes,
          colorHex: habit.colorHex,
        },
      }),
    ),
  );

  const totals: SeedTotals = {
    strengthXp: 0,
    enduranceXp: 0,
    intelligenceXp: 0,
    wisdomXp: 0,
    charismaXp: 0,
    dexterityXp: 0,
  };
  let cycleXp = 0;
  let sessionCount = 0;

  const today = new Date();

  for (let dayOffset = DAYS_OF_HISTORY - 1; dayOffset >= 0; dayOffset--) {
    const day = new Date(today.getTime() - dayOffset * 86_400_000);
    const dateKey = localDateKey(day, TIMEZONE);
    const dayIndex = DAYS_OF_HISTORY - 1 - dayOffset;

    // Per-day, per-category minute tallies drive the daily cap the same way the
    // service does at runtime.
    const minutesByCategory = new Map<Category, number>();
    let minutesTotal = 0;

    for (const [index, seedHabit] of HABITS.entries()) {
      const minutes = seedHabit.dailyMinutes[dayIndex] ?? 0;
      if (minutes === 0) continue;

      const habit = habits[index];
      if (!habit) continue;

      const category = seedHabit.category;
      const stat = resolveStat(category, seedHabit.stat);
      const streakDays = countStreak(seedHabit.dailyMinutes, dayIndex);

      const result = calculateSessionXp({
        durationSec: minutes * 60,
        category,
        stat,
        verification: 'TIMER_ONLY',
        streakDays,
        interruptions: dayIndex % 4 === 0 ? 2 : 0,
        characterClass: null,
        prestige: 0,
        eventMultiplier: 1,
        minutesTodayInCategory: minutesByCategory.get(category) ?? 0,
        minutesTodayTotal: minutesTotal,
      });

      // 19:00 local-ish start, staggered per habit so sessions never overlap.
      const startedAt = new Date(day);
      startedAt.setHours(19 + index, 0, 0, 0);
      const endedAt = new Date(startedAt.getTime() + minutes * 60_000);

      await prisma.session.create({
        data: {
          userId: user.id,
          habitId: habit.id,
          clientRequestId: `seed-${dateKey}-${habit.id}`,
          startedAt,
          endedAt,
          durationSec: minutes * 60,
          status: 'COMPLETED',
          interruptions: dayIndex % 4 === 0 ? 2 : 0,
          xpAwarded: result.xp,
          statXp: result.statXp,
          multiplierData: result.breakdown as unknown as object,
          verification: 'TIMER_ONLY',
        },
      });

      await prisma.xpLedger.create({
        data: {
          userId: user.id,
          amount: result.xp,
          reason: 'SESSION_AWARD',
          note: `${seedHabit.name} · ${result.breakdown.fullRateMinutes} min`,
          createdAt: endedAt,
        },
      });

      await prisma.dailyUsage.upsert({
        where: { userId_dateKey_category: { userId: user.id, dateKey, category } },
        create: {
          userId: user.id,
          dateKey,
          category,
          fullRateMinutes: result.breakdown.fullRateMinutes,
          overCapMinutes: result.breakdown.overCapMinutes,
        },
        update: {
          fullRateMinutes: { increment: result.breakdown.fullRateMinutes },
          overCapMinutes: { increment: result.breakdown.overCapMinutes },
        },
      });

      minutesByCategory.set(
        category,
        (minutesByCategory.get(category) ?? 0) + result.breakdown.fullRateMinutes,
      );
      minutesTotal += result.breakdown.fullRateMinutes;

      cycleXp += result.xp;
      totals[STAT_COLUMN[stat]] += result.statXp;
      sessionCount++;

      await prisma.habit.update({
        where: { id: habit.id },
        data: {
          currentStreak: streakDays + 1,
          longestStreak: { set: Math.max(streakDays + 1, habit.longestStreak) },
          lastCompletedDate: dateKey,
        },
      });
    }
  }

  const progress = levelProgress(cycleXp);
  const statXpSheet = {
    STR: totals.strengthXp,
    END: totals.enduranceXp,
    INT: totals.intelligenceXp,
    WIS: totals.wisdomXp,
    CHA: totals.charismaXp,
    DEX: totals.dexterityXp,
  };
  const statSheet = deriveStatSheet(statXpSheet);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      ...totals,
      cycleXp,
      lifetimeXp: BigInt(cycleXp),
      level: progress.level,
      classType: suggestClass(statSheet, progress.level),
    },
  });

  console.log(
    [
      `Seeded ${user.username}:`,
      `  ${habits.length} habits, ${sessionCount} sessions over ${DAYS_OF_HISTORY} days`,
      `  ${cycleXp} XP -> level ${progress.level} (${progress.xpIntoLevel}/${progress.xpForNextLevel})`,
      `  stats ${JSON.stringify(statSheet)}`,
      `  dev auth header: x-dev-user-id: ${user.id}`,
    ].join('\n'),
  );
}

/** Consecutive non-zero days immediately before `dayIndex`. */
function countStreak(dailyMinutes: readonly number[], dayIndex: number): number {
  let streak = 0;
  for (let i = dayIndex - 1; i >= 0; i--) {
    if ((dailyMinutes[i] ?? 0) === 0) break;
    streak++;
  }
  return streak;
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
