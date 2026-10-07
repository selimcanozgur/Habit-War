/**
 * The story (docs/game-design.md §2–3).
 *
 * A player's place on the road — chapter, fight, damage — is never stored. It is
 * derived on every read by feeding the sessions completed since the story began, in
 * order, through the domain's `advanceStory`: one damage per active second, more
 * against the monster's weakness, spilling into the next fight when one ends. The
 * battle screen runs the same function on the live session, so the number the player
 * watches and the number the server settles are the same number.
 *
 * Only `User.storyStartedAt` is stored: work done before the story existed does not
 * count, or a long-time user would open the story already in chapter ten.
 *
 * Abandoned sessions never reach the story (they are not COMPLETED), and flagged ones
 * are left out like everywhere else rewards are computed (spec §4).
 */

import {
  STORY_CHAPTERS,
  STORY_START,
  advanceStory,
  chapterMonster,
  fightMaxHp,
  isBossFight,
  isStoryFinished,
  resolveStat,
  storySeconds,
  type Category,
  type FightWon,
  type Stat,
  type StoryPosition,
} from '@habitwar/domain';
import type { PrismaClient } from '@prisma/client';

import { notFound } from '../../lib/errors.js';

export type Clock = () => Date;

/** The fight under way, as the battle screen draws it. */
export interface CurrentFight {
  readonly chapter: number;
  readonly fight: number;
  readonly isBoss: boolean;
  readonly monsterKey: string;
  /** The monster's name, or its boss's in the fourth fight. */
  readonly name: string;
  readonly weakness: Stat;
  readonly maxHp: number;
  readonly damage: number;
  readonly hp: number;
}

export interface ChapterCompleted {
  readonly chapter: number;
  readonly monsterKey: string;
  readonly bossName: string;
  readonly title: string;
  readonly completedAt: Date;
}

export interface StoryState {
  readonly startedAt: Date;
  readonly position: StoryPosition;
  readonly finished: boolean;
  /** Null once the story is finished. */
  readonly current: CurrentFight | null;
  /** Chapters whose boss has fallen, oldest first. */
  readonly completed: readonly ChapterCompleted[];
}

export interface FightWonView extends FightWon {
  readonly name: string;
  /** Earned when the fight was a boss; empty otherwise. */
  readonly title: string;
}

/** What one session did to the story, for the reward screen. */
export interface StorySessionResult {
  readonly damage: number;
  readonly won: readonly FightWonView[];
  readonly current: CurrentFight | null;
}

export class StoryService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: { prisma: PrismaClient; now: Clock }) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /** The player's story as it stands. Starts it on first contact. */
  async state(userId: string): Promise<StoryState> {
    const startedAt = await this.#startedAt(userId, this.#now());
    return (await this.#replay(userId, startedAt, null)).state;
  }

  /**
   * What a just-completed session did to the story. Called after the session's award
   * has committed. A player whose story has not begun begins it with this session, so
   * their very first work already lands a blow.
   */
  async afterSession(userId: string, sessionId: string): Promise<StorySessionResult | null> {
    const session = await this.#prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { startedAt: true },
    });
    if (!session) return null;
    const startedAt = await this.#startedAt(userId, session.startedAt);
    const { state, step } = await this.#replay(userId, startedAt, sessionId);
    if (!step) return null;
    return {
      damage: step.damage,
      won: step.won.map(describeWin),
      current: state.current,
    };
  }

  /**
   * Feeds the story sessions through `advanceStory`, in completion order. When
   * `sessionId` is given, also returns that session's own step.
   */
  async #replay(
    userId: string,
    startedAt: Date,
    sessionId: string | null,
  ): Promise<{ state: StoryState; step: ReturnType<typeof advanceStory> | null }> {
    const sessions = await this.#prisma.session.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        isFlagged: false,
        endedAt: { gte: startedAt },
      },
      orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        durationSec: true,
        endedAt: true,
        habit: { select: { category: true, stat: true } },
      },
    });

    let position: StoryPosition = STORY_START;
    let step: ReturnType<typeof advanceStory> | null = null;
    const completed: ChapterCompleted[] = [];

    for (const session of sessions) {
      const stat = resolveStat(session.habit.category as Category, session.habit.stat as Stat | null);
      const result = advanceStory(position, storySeconds(session.durationSec ?? 0), stat);
      for (const win of result.won) {
        if (!win.isBoss) continue;
        const monster = chapterMonster(win.chapter);
        completed.push({
          chapter: win.chapter,
          monsterKey: monster.key,
          bossName: monster.bossName,
          title: monster.title,
          completedAt: session.endedAt as Date,
        });
      }
      if (session.id === sessionId) step = result;
      position = result.position;
    }

    return {
      state: {
        startedAt,
        position,
        finished: isStoryFinished(position),
        current: currentFight(position),
        completed,
      },
      step,
    };
  }

  /**
   * When the player's story began; set on first contact. `from` is the instant to
   * start it at if it has not begun — now for a read, or the start of the session
   * that brings a player to the story, so that session counts.
   */
  async #startedAt(userId: string, from: Date): Promise<Date> {
    const user = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { storyStartedAt: true },
    });
    if (!user) throw notFound('User not found');
    if (user.storyStartedAt) return user.storyStartedAt;
    // Conditional, so two first contacts racing cannot move the start twice.
    await this.#prisma.user.updateMany({
      where: { id: userId, storyStartedAt: null },
      data: { storyStartedAt: from },
    });
    const after = await this.#prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storyStartedAt: true },
    });
    return after.storyStartedAt ?? from;
  }
}

function currentFight(position: StoryPosition): CurrentFight | null {
  if (isStoryFinished(position) || position.chapter > STORY_CHAPTERS) return null;
  const monster = chapterMonster(position.chapter);
  const boss = isBossFight(position.fight);
  const maxHp = fightMaxHp(position.chapter, position.fight);
  return {
    chapter: position.chapter,
    fight: position.fight,
    isBoss: boss,
    monsterKey: monster.key,
    name: boss ? monster.bossName : monster.name,
    weakness: monster.weakness,
    maxHp,
    damage: position.damage,
    hp: Math.max(0, maxHp - position.damage),
  };
}

function describeWin(win: FightWon): FightWonView {
  const monster = chapterMonster(win.chapter);
  return {
    ...win,
    name: win.isBoss ? monster.bossName : monster.name,
    title: win.isBoss ? monster.title : '',
  };
}
