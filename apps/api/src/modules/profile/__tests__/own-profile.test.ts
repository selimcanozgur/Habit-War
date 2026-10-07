/** The own profile's first-run flag and the account day streak. */

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ProfileService } from '../service.js';

const prisma = new PrismaClient();
const PREFIX = 'test_onb_';
let clock = new Date('2024-06-05T09:00:00.000Z');
let userId: string;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  clock = new Date('2024-06-05T09:00:00.000Z');
  userId = (
    await prisma.user.create({
      data: { username: `${PREFIX}u`, displayName: 'u', email: `${PREFIX}u@example.com` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('onboarding', () => {
  it('starts unfinished and is marked once', async () => {
    const service = new ProfileService({ prisma, now: () => clock });
    expect((await service.getOwnProfile(userId)).onboardedAt).toBeNull();

    const first = await service.completeOnboarding(userId);
    clock = new Date(clock.getTime() + 60_000);
    const again = await service.completeOnboarding(userId);

    expect(again.onboardedAt).toEqual(first.onboardedAt);
    expect((await service.getOwnProfile(userId)).onboardedAt).toEqual(first.onboardedAt);
  });
});

describe('day streak', () => {
  async function completedAt(iso: string): Promise<void> {
    const habit =
      (await prisma.habit.findFirst({ where: { userId } })) ??
      (await prisma.habit.create({
        data: { userId, name: 'h', category: 'FITNESS', stat: 'STR', targetMinutes: 10, colorHex: '#000000' },
      }));
    const endedAt = new Date(iso);
    await prisma.session.create({
      data: {
        userId,
        habitId: habit.id,
        clientRequestId: `${PREFIX}${iso}`,
        startedAt: new Date(endedAt.getTime() - 600_000),
        endedAt,
        durationSec: 600,
        status: 'COMPLETED',
      },
    });
  }

  it('counts consecutive days ending today, or yesterday while today is open', async () => {
    const service = new ProfileService({ prisma, now: () => clock });
    // The test user's timezone is the default (Europe/Istanbul); clock is 2024-06-05 12:00 local.
    expect((await service.getOwnProfile(userId)).dayStreak).toBe(0);

    await completedAt('2024-06-03T08:00:00.000Z');
    await completedAt('2024-06-04T08:00:00.000Z');
    expect((await service.getOwnProfile(userId)).dayStreak).toBe(2);

    await completedAt('2024-06-05T08:00:00.000Z');
    expect((await service.getOwnProfile(userId)).dayStreak).toBe(3);

    // A gap ends it: two days on from the last session, nothing is alive.
    clock = new Date('2024-06-07T09:00:00.000Z');
    expect((await service.getOwnProfile(userId)).dayStreak).toBe(0);
  });
});
