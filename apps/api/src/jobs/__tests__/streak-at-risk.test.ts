/**
 * Streak-at-risk reminders.
 *
 * The interesting logic is the timezone selection, and it is pure — so most of this
 * file needs no database at all, which is exactly why `selectDueUsers`,
 * `isHabitAtRisk` and `pickHeadlineHabit` are separate exported functions instead of
 * three `if`s buried in the query loop.
 *
 * The database half proves the two things purity cannot: that the right users are
 * selected out of a real table, and that the dedupe window stops the hourly schedule
 * from warning the same person twice.
 *
 * The clock is frozen at 18:00 UTC on 2024-03-15, which is 20:00 in
 * Africa/Johannesburg (UTC+2 all year, no DST to argue about) and 21:00 in
 * Europe/Istanbul. That is also what keeps the development seed — every one of whose
 * users is in Europe/Istanbul, with 2026 completion dates — out of these results.
 */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobContext } from '../context.js';
import { createLogger } from '../logger.js';
import {
  isHabitAtRisk,
  pickHeadlineHabit,
  runStreakAtRisk,
  selectDueUsers,
  streakAtRiskCopy,
} from '../tasks/streak-at-risk.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_streak_';

/** 18:00 UTC → 20:00 in Africa/Johannesburg, 21:00 in Europe/Istanbul. */
const NOW = new Date('2024-03-15T18:00:00.000Z');
const TODAY_SAST = '2024-03-15';
const YESTERDAY_SAST = '2024-03-14';
const HOUR = 3_600_000;

let dueUserId: string;
let wrongHourUserId: string;
let alreadyLoggedUserId: string;
let shortStreakUserId: string;

function context(now: Date = NOW): JobContext {
  return {
    prisma,
    now,
    logger: createLogger({ level: 'fatal', name: 'test', write: () => {} }),
  };
}

async function makeUser(suffix: string, timezone: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
      timezone,
    },
  });
  return user.id;
}

async function makeHabit(
  userId: string,
  name: string,
  currentStreak: number,
  lastCompletedDate: string | null,
): Promise<void> {
  await prisma.habit.create({
    data: { userId, name, category: 'STUDY', stat: 'INT', targetMinutes: 30, currentStreak, lastCompletedDate },
  });
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

async function notificationsFor(userId: string) {
  return prisma.notification.findMany({ where: { userId, type: 'STREAK_AT_RISK' } });
}

beforeEach(async () => {
  await cleanup();

  // 20:00 local, streak alive, nothing logged today → the one user to warn.
  dueUserId = await makeUser('due', 'Africa/Johannesburg');
  await makeHabit(dueUserId, 'Kitap okuma', 9, YESTERDAY_SAST);
  await makeHabit(dueUserId, 'Almanca', 4, YESTERDAY_SAST);

  // Same situation, but it is 21:00 on their clock — their tick was an hour ago.
  wrongHourUserId = await makeUser('wronghour', 'Europe/Istanbul');
  await makeHabit(wrongHourUserId, 'Kitap okuma', 9, '2024-03-14');

  // 20:00 local, but they already trained today. Nothing is at risk.
  alreadyLoggedUserId = await makeUser('logged', 'Africa/Johannesburg');
  await makeHabit(alreadyLoggedUserId, 'Kitap okuma', 9, TODAY_SAST);

  // 20:00 local, but a two-day streak is not yet a habit worth a notification.
  shortStreakUserId = await makeUser('short', 'Africa/Johannesburg');
  await makeHabit(shortStreakUserId, 'Kitap okuma', 2, YESTERDAY_SAST);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('selectDueUsers', () => {
  const at = (iso: string) => new Date(iso);

  it('matches each user on the tick where their own clock reads the reminder hour', () => {
    const users = [
      { id: 'jhb', timezone: 'Africa/Johannesburg' }, // UTC+2
      { id: 'ist', timezone: 'Europe/Istanbul' }, // UTC+3
      { id: 'nyc', timezone: 'America/New_York' }, // UTC-4 in March
    ];

    expect(selectDueUsers(users, at('2024-03-15T18:00:00Z')).due.map((u) => u.id)).toEqual(['jhb']);
    expect(selectDueUsers(users, at('2024-03-15T17:00:00Z')).due.map((u) => u.id)).toEqual(['ist']);
    expect(selectDueUsers(users, at('2024-03-16T00:00:00Z')).due.map((u) => u.id)).toEqual(['nyc']);
  });

  /** The case offset arithmetic gets wrong: +05:30 is never on a whole UTC hour. */
  it('matches half-hour and quarter-hour zones', () => {
    const users = [
      { id: 'kolkata', timezone: 'Asia/Kolkata' }, // +05:30 → 20:30 local
      { id: 'kathmandu', timezone: 'Asia/Kathmandu' }, // +05:45 → 20:45 local
    ];

    const due = selectDueUsers(users, at('2024-03-15T15:00:00Z')).due.map((u) => u.id);
    expect(due).toEqual(['kolkata', 'kathmandu']);
    // ...and only on that one tick.
    expect(selectDueUsers(users, at('2024-03-15T14:00:00Z')).due).toHaveLength(0);
  });

  it('fires exactly once per user per day', () => {
    const user = [{ id: 'jhb', timezone: 'Africa/Johannesburg' }];
    let hits = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const tick = new Date(Date.UTC(2024, 2, 15, hour, 0, 0));
      hits += selectDueUsers(user, tick).due.length;
    }
    expect(hits).toBe(1);
  });

  it('sets a broken timezone aside instead of throwing', () => {
    const users = [
      { id: 'broken', timezone: 'Mars/Olympus' },
      { id: 'jhb', timezone: 'Africa/Johannesburg' },
    ];
    const result = selectDueUsers(users, at('2024-03-15T18:00:00Z'));

    expect(result.invalidTimezones.map((u) => u.id)).toEqual(['broken']);
    expect(result.due.map((u) => u.id)).toEqual(['jhb']);
  });
});

describe('isHabitAtRisk', () => {
  const habit = (currentStreak: number, lastCompletedDate: string | null) => ({
    name: 'Kitap okuma',
    currentStreak,
    lastCompletedDate,
  });

  it('is true only when the last completion was exactly yesterday', () => {
    expect(isHabitAtRisk(habit(5, '2024-03-14'), '2024-03-15')).toBe(true);
    // Already done today.
    expect(isHabitAtRisk(habit(5, '2024-03-15'), '2024-03-15')).toBe(false);
    // Already broken: warning now is a day late.
    expect(isHabitAtRisk(habit(5, '2024-03-13'), '2024-03-15')).toBe(false);
  });

  it('ignores streaks too short to be worth interrupting someone for', () => {
    expect(isHabitAtRisk(habit(2, '2024-03-14'), '2024-03-15')).toBe(false);
  });

  it('is total: a null or malformed date key is not a crash', () => {
    expect(isHabitAtRisk(habit(5, null), '2024-03-15')).toBe(false);
    expect(isHabitAtRisk(habit(5, 'dün'), '2024-03-15')).toBe(false);
  });
});

describe('pickHeadlineHabit', () => {
  it('leads with the longest streak and counts the rest', () => {
    const picked = pickHeadlineHabit(
      [
        { name: 'Almanca', currentStreak: 4, lastCompletedDate: '2024-03-14' },
        { name: 'Kitap okuma', currentStreak: 9, lastCompletedDate: '2024-03-14' },
        { name: 'Yüzme', currentStreak: 30, lastCompletedDate: '2024-03-15' }, // done today
      ],
      '2024-03-15',
    );

    expect(picked?.headline.name).toBe('Kitap okuma');
    expect(picked?.alsoAtRisk).toBe(1);
  });

  it('returns null when nothing is at risk', () => {
    expect(
      pickHeadlineHabit([{ name: 'Yüzme', currentStreak: 30, lastCompletedDate: '2024-03-15' }], '2024-03-15'),
    ).toBeNull();
  });
});

describe('streakAtRiskCopy', () => {
  it('is Turkish and names the habit', () => {
    const copy = streakAtRiskCopy(
      { name: 'Kitap okuma', currentStreak: 9, lastCompletedDate: '2024-03-14' },
      0,
    );
    expect(copy.title).toBe('9 günlük serin bugün sona eriyor');
    expect(copy.body).toBe('Kitap okuma için bugün henüz bir seans yok. Kısa bir seans bile seriyi sürdürmeye yeter.');
  });

  it('rolls the others into one sentence rather than one notification each', () => {
    const copy = streakAtRiskCopy(
      { name: 'Kitap okuma', currentStreak: 9, lastCompletedDate: '2024-03-14' },
      2,
    );
    expect(copy.body).toContain('ve 2 alışkanlık daha');
  });

  it('clamps a habit name that would overflow the column', () => {
    const copy = streakAtRiskCopy(
      { name: 'A'.repeat(300), currentStreak: 5, lastCompletedDate: '2024-03-14' },
      0,
    );
    expect(copy.title.length).toBeLessThanOrEqual(120);
    expect((copy.body ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('runStreakAtRisk', () => {
  it('warns the user whose local clock has reached the reminder hour', async () => {
    await runStreakAtRisk(context());

    const notifications = await notificationsFor(dueUserId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('9 günlük serin bugün sona eriyor');
    // Two habits at risk, one notification.
    expect(notifications[0]?.body).toContain('ve 1 alışkanlık daha');
    expect(notifications[0]?.actorId).toBeNull();
  });

  it('does not warn a user whose local clock reads a different hour', async () => {
    await runStreakAtRisk(context());
    expect(await notificationsFor(wrongHourUserId)).toHaveLength(0);
  });

  it('warns that same user on the tick that IS their 20:00', async () => {
    await runStreakAtRisk(context(new Date('2024-03-15T17:00:00.000Z')));

    expect(await notificationsFor(wrongHourUserId)).toHaveLength(1);
    // ...and the Johannesburg user is not warned an hour early.
    expect(await notificationsFor(dueUserId)).toHaveLength(0);
  });

  it('says nothing to a user who already trained today', async () => {
    await runStreakAtRisk(context());
    expect(await notificationsFor(alreadyLoggedUserId)).toHaveLength(0);
  });

  it('says nothing about a streak too short to matter', async () => {
    await runStreakAtRisk(context());
    expect(await notificationsFor(shortStreakUserId)).toHaveLength(0);
  });

  it('is idempotent: a retry inside the dedupe window writes nothing new', async () => {
    await runStreakAtRisk(context());
    const second = await runStreakAtRisk(context(new Date(NOW.getTime() + 30 * 60_000)));

    expect(await notificationsFor(dueUserId)).toHaveLength(1);
    expect(second.deduped).toBeGreaterThanOrEqual(1);
  });

  it('warns again once the dedupe window has passed', async () => {
    await runStreakAtRisk(context());

    // The next day's tick, 24 hours later: outside the 23-hour window.
    const tomorrow = new Date(NOW.getTime() + 24 * HOUR);
    await prisma.habit.updateMany({
      where: { userId: dueUserId },
      data: { lastCompletedDate: TODAY_SAST },
    });
    await runStreakAtRisk(context(tomorrow));

    expect(await notificationsFor(dueUserId)).toHaveLength(2);
  });
});
