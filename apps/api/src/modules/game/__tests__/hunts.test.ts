/**
 * Monster hunts: the bestiary by level, damage derived from sessions, the weakness
 * bonus, the final blow, and switching monsters.
 */

import {
  MONSTERS,
  MONSTER_STAGES,
  MONSTER_WEAKNESS_MULTIPLIER,
  cumulativeXpForLevel,
  monsterByKey,
  monsterMaxHp,
} from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { HuntService } from '../hunts.js';

const prisma = new PrismaClient();
const PREFIX = 'test_hunt_';

let clock = new Date('2024-06-05T09:00:00.000Z');
const now = (): Date => clock;
const advance = (minutes: number): void => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

let service: HuntService;
let userId: string;
let studyHabitId: string;
let fitnessHabitId: string;
let counter = 0;

/** A completed session ending now, then the clock moves on a minute. */
async function hit(habitId: string, xp: number, flagged = false): Promise<string> {
  counter += 1;
  const session = await prisma.session.create({
    data: {
      userId,
      habitId,
      clientRequestId: `${PREFIX}${counter}-${Date.now()}`,
      startedAt: new Date(clock.getTime() - 30 * 60_000),
      endedAt: clock,
      durationSec: 1800,
      status: 'COMPLETED',
      xpAwarded: xp,
      isFlagged: flagged,
    },
  });
  advance(1);
  return session.id;
}

async function setLevel(level: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { cycleXp: cumulativeXpForLevel(level) } });
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-06-05T09:00:00.000Z');
  service = new HuntService({ prisma, now });
  userId = (
    await prisma.user.create({
      data: { username: `${PREFIX}u`, displayName: 'u', email: `${PREFIX}u@example.com` },
    })
  ).id;
  studyHabitId = (
    await prisma.habit.create({
      data: { userId, name: 'Kitap okuma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
    })
  ).id;
  fitnessHabitId = (
    await prisma.habit.create({
      data: { userId, name: 'Şınav', category: 'FITNESS', stat: 'STR', targetMinutes: 20 },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('the bestiary', () => {
  it('starts a new player on the first monster', async () => {
    const book = await service.bestiary(userId);
    expect(book.playerLevel).toBe(1);
    expect(book.active?.monster.key).toBe(MONSTERS[0]?.key);
    expect(book.active?.stage).toBe(1);
    expect(book.active?.hp).toBe(monsterMaxHp(1, 1));
  });

  it('shows every monster, unlocked up to the player\'s level', async () => {
    await setLevel(5);
    const book = await service.bestiary(userId);
    expect(book.monsters).toHaveLength(MONSTERS.length);
    for (const monster of book.monsters) expect(monster.unlocked).toBe(monster.level <= 5);
  });
});

describe('damage', () => {
  it('is each session\'s XP, more against the weakness, and skips flagged work', async () => {
    await service.bestiary(userId); // starts the slime, weak to STR
    expect(MONSTERS[0]?.weakness).toBe('STR');
    // Kept under the first rung's HP, so the hunt is still running when read.
    await hit(studyHabitId, 10);
    await hit(fitnessHabitId, 10);
    await hit(studyHabitId, 50, true);

    const { active } = await service.bestiary(userId);
    expect(active?.damage).toBe(10 + 10 * MONSTER_WEAKNESS_MULTIPLIER);
    expect(active?.hits[0]).toMatchObject({ habitName: 'Şınav', weakness: true });
  });

  it('ignores sessions from before the hunt began', async () => {
    await hit(studyHabitId, 40);
    const { active } = await service.bestiary(userId);
    expect(active?.damage).toBe(0);
  });
});

describe('the final blow', () => {
  it('beats the monster and raises it a level — no title below the boss', async () => {
    await service.bestiary(userId);
    await hit(studyHabitId, 20);
    const finalBlow = await hit(studyHabitId, 30);

    const result = await service.afterSession(userId, finalBlow);
    expect(result).toMatchObject({ defeated: true, hp: 0, stage: 1, isBoss: false, title: '' });

    const book = await service.bestiary(userId);
    expect(book.active).toBeNull();
    expect(book.trophies).toHaveLength(0);
    expect(book.monsters[0]).toMatchObject({ defeats: 1, stage: 2 });
  });

  it('brings the next hunt of the same monster a level higher and tougher', async () => {
    await service.bestiary(userId);
    await hit(studyHabitId, 200);
    await service.bestiary(userId); // closes the hunt

    const next = await service.start(userId, MONSTERS[0]?.key ?? '');
    expect(next.stage).toBe(2);
    expect(next.maxHp).toBe(monsterMaxHp(1, 2));
  });

  it('does not count sessions after the final blow toward the beaten monster', async () => {
    await service.bestiary(userId);
    await hit(studyHabitId, 200);
    await service.bestiary(userId); // closes the hunt
    await hit(studyHabitId, 200);

    const book = await service.bestiary(userId);
    expect(book.monsters[0]?.defeats).toBe(1);
    expect(book.active).toBeNull();
  });
});

describe('the boss', () => {
  it('waits at the top of the ladder, and pays the trophy and the title', async () => {
    const slime = MONSTERS[0];
    if (!slime) throw new Error('missing');
    // Every rung below the boss already beaten.
    for (let stage = 1; stage < MONSTER_STAGES; stage++) {
      await prisma.monsterHunt.create({
        data: {
          userId,
          monsterKey: slime.key,
          level: slime.level,
          stage,
          maxHp: monsterMaxHp(slime.level, stage),
          status: 'DEFEATED',
          startedAt: new Date(clock.getTime() - 60_000),
          endedAt: new Date(clock.getTime() - 60_000),
        },
      });
    }

    const boss = await service.start(userId, slime.key);
    expect(boss).toMatchObject({ stage: MONSTER_STAGES, isBoss: true, name: slime.bossName });
    expect(boss.maxHp).toBe(monsterMaxHp(slime.level, MONSTER_STAGES));

    const finalBlow = await hit(studyHabitId, boss.maxHp);
    const result = await service.afterSession(userId, finalBlow);
    expect(result).toMatchObject({ defeated: true, isBoss: true, title: slime.title });

    const book = await service.bestiary(userId);
    expect(book.trophies).toHaveLength(1);
    expect(book.trophies[0]).toMatchObject({ name: slime.bossName, title: slime.title });
    expect(book.monsters[0]?.conquered).toBe(true);
  });
});

describe('choosing a monster', () => {
  it('leaves the old hunt and starts fresh — progress does not carry over', async () => {
    await setLevel(5);
    await service.bestiary(userId);
    await hit(studyHabitId, 40);

    const golem = await service.start(userId, 'procrastination-golem');
    expect(golem.monster.key).toBe('procrastination-golem');
    expect(golem.damage).toBe(0);
    expect(golem.stage).toBe(1);
    expect(golem.maxHp).toBe(monsterMaxHp(monsterByKey('procrastination-golem')?.level ?? 0, 1));

    const fled = await prisma.monsterHunt.count({ where: { userId, status: 'FLED' } });
    expect(fled).toBe(1);
  });

  it('refuses a monster above the player\'s level', async () => {
    await expect(service.start(userId, 'habit-devourer')).rejects.toMatchObject({ statusCode: 422 });
  });
});
