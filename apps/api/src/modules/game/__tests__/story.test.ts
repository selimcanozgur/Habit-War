/**
 * The story service: the player's place derived from completed sessions — one damage
 * per second, the weakness bonus, spill-over, the story's start, and what one session
 * did.
 */

import { MONSTERS, fightMaxHp } from '@habitwar/domain';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { StoryService } from '../story.js';

const prisma = new PrismaClient();
const PREFIX = 'test_story_';
const MINUTE = 60_000;

let clock = new Date('2024-06-05T09:00:00.000Z');
const now = (): Date => clock;

let service: StoryService;
let userId: string;
let readingId: string; // STUDY -> INT: neutral against chapter 1 (weak to STR)
let pushupsId: string; // FITNESS -> STR: chapter 1's weakness
let counter = 0;

/** A completed session of `seconds`, ending at the clock; then the clock moves on. */
async function session(habitId: string, seconds: number, flagged = false): Promise<string> {
  counter += 1;
  const created = await prisma.session.create({
    data: {
      userId,
      habitId,
      clientRequestId: `${PREFIX}${counter}-${Date.now()}`,
      startedAt: new Date(clock.getTime() - seconds * 1000),
      endedAt: clock,
      durationSec: seconds,
      status: 'COMPLETED',
      xpAwarded: 10,
      isFlagged: flagged,
    },
  });
  clock = new Date(clock.getTime() + MINUTE);
  return created.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-06-05T09:00:00.000Z');
  service = new StoryService({ prisma, now });
  userId = (
    await prisma.user.create({
      data: { username: `${PREFIX}u`, displayName: 'u', email: `${PREFIX}u@example.com` },
    })
  ).id;
  readingId = (
    await prisma.habit.create({
      data: { userId, name: 'Okuma', category: 'STUDY', stat: 'INT', targetMinutes: 30 },
    })
  ).id;
  pushupsId = (
    await prisma.habit.create({
      data: { userId, name: 'Şınav', category: 'FITNESS', stat: 'STR', targetMinutes: 15 },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('the story', () => {
  it('starts at chapter one, fight one, full HP', async () => {
    const story = await service.state(userId);
    expect(story.position).toEqual({ chapter: 1, fight: 1, damage: 0 });
    expect(story.current).toMatchObject({
      monsterKey: MONSTERS[0]?.key,
      isBoss: false,
      maxHp: fightMaxHp(1, 1),
      hp: fightMaxHp(1, 1),
    });
  });

  it('ignores work done before it began', async () => {
    await session(readingId, 600); // before first contact
    await service.state(userId); // the story begins now
    expect((await service.state(userId)).position.damage).toBe(0);
  });

  it('takes one damage per second, and more against the weakness', async () => {
    await service.state(userId);
    await session(readingId, 100);
    await session(pushupsId, 100);
    expect((await service.state(userId)).position.damage).toBe(100 + 150);
  });

  it('leaves flagged sessions out', async () => {
    await service.state(userId);
    await session(readingId, 200, true);
    expect((await service.state(userId)).position.damage).toBe(0);
  });

  it('spills a won fight into the next one', async () => {
    await service.state(userId);
    await session(readingId, fightMaxHp(1, 1) + 40);
    expect((await service.state(userId)).position).toEqual({ chapter: 1, fight: 2, damage: 40 });
  });
});

describe('afterSession', () => {
  it('reports the session\'s damage and the fights it won', async () => {
    await service.state(userId);
    const id = await session(readingId, fightMaxHp(1, 1) + 10);
    const result = await service.afterSession(userId, id);
    expect(result?.damage).toBe(fightMaxHp(1, 1) + 10);
    expect(result?.won).toEqual([
      expect.objectContaining({ chapter: 1, fight: 1, isBoss: false, title: '' }),
    ]);
    expect(result?.current).toMatchObject({ chapter: 1, fight: 2, damage: 10 });
  });

  it('begins the story with the first session a player ever completes', async () => {
    const id = await session(readingId, 120);
    const result = await service.afterSession(userId, id);
    expect(result?.damage).toBe(120);
  });

  it('pays the title when a boss falls, and completes the chapter', async () => {
    await service.state(userId);
    const chapterOne = fightMaxHp(1, 1) + fightMaxHp(1, 2) + fightMaxHp(1, 3) + fightMaxHp(1, 4);
    const id = await session(readingId, chapterOne);
    const result = await service.afterSession(userId, id);
    expect(result?.won).toHaveLength(4);
    expect(result?.won[3]).toMatchObject({ isBoss: true, title: MONSTERS[0]?.title });

    const story = await service.state(userId);
    expect(story.position).toEqual({ chapter: 2, fight: 1, damage: 0 });
    expect(story.completed).toEqual([
      expect.objectContaining({ chapter: 1, title: MONSTERS[0]?.title }),
    ]);
  });
});
