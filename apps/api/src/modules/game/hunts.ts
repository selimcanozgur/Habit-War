/**
 * Monster hunts.
 *
 * The bestiary (`@habitwar/domain` MONSTERS) is visible to every player: monsters at
 * or below their character level can be hunted, the rest show the level that opens
 * them. A player hunts one monster at a time; every session they complete while the
 * hunt is active hits it, and a session training the monster's weak stat hits harder.
 *
 * Each monster has a ladder of MONSTER_STAGES levels. Beating it raises it a level —
 * the next hunt of the same monster is tougher — and the top level is its boss.
 * Beating the boss pays a trophy and the monster's title. Nothing pays XP. Monsters are where
 * earned XP is spent, so the game can only be played by doing the real thing, and it
 * cannot inflate levels or the leaderboard.
 *
 * Only the hunt's identity is stored (MonsterHunt). Damage is derived on every read
 * from the sessions completed inside the hunt's window, so it cannot disagree with the
 * XP it comes from.
 *
 * Switching monsters is free: the old hunt is marked FLED and its progress is simply
 * left behind. No penalty — consistent with the product's no-punishment rule.
 */

import {
  MONSTERS,
  MONSTER_STAGES,
  isBossStage,
  isMonsterUnlocked,
  levelProgress,
  monsterByKey,
  monsterDamage,
  monsterMaxHp,
  nextStage,
  resolveStat,
  type Category,
  type MonsterDefinition,
  type Stat,
} from '@habitwar/domain';
import type { MonsterHunt, PrismaClient } from '@prisma/client';

import { notFound, unprocessable } from '../../lib/errors.js';

export type Clock = () => Date;

export interface HuntHit {
  readonly sessionId: string;
  readonly habitName: string;
  readonly stat: Stat;
  readonly damage: number;
  /** True when the session trained the monster's weak stat. */
  readonly weakness: boolean;
  readonly at: Date;
}

export interface MonsterEntry {
  readonly key: string;
  readonly name: string;
  readonly bossName: string;
  readonly tagline: string;
  /** The player level that unlocks it. */
  readonly level: number;
  readonly weakness: Stat;
  /** Paid for beating its boss. */
  readonly title: string;
  /** The ladder level the player fights next, 1..stages. */
  readonly stage: number;
  readonly stages: number;
  /** HP of the next fight. */
  readonly maxHp: number;
  /** The player's level reaches it. */
  readonly unlocked: boolean;
  /** Times the player has beaten it, at any level. */
  readonly defeats: number;
  /** Its boss has fallen to this player at least once. */
  readonly conquered: boolean;
}

export interface HuntView {
  readonly id: string;
  readonly monster: MonsterEntry;
  /** The ladder level of this fight. */
  readonly stage: number;
  readonly isBoss: boolean;
  /** The monster's name, or its boss's at the top of the ladder. */
  readonly name: string;
  readonly status: 'ACTIVE' | 'DEFEATED' | 'FLED';
  readonly maxHp: number;
  readonly damage: number;
  /** HP left, floored at zero. */
  readonly hp: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  /** Hits, newest first. */
  readonly hits: readonly HuntHit[];
}

export interface Trophy {
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly level: number;
  readonly defeatedAt: Date;
}

export interface Bestiary {
  readonly playerLevel: number;
  readonly active: HuntView | null;
  readonly monsters: readonly MonsterEntry[];
  readonly trophies: readonly Trophy[];
}

/** What one session just did to the hunted monster, for the reward screen. */
export interface HuntSessionResult {
  readonly name: string;
  readonly stage: number;
  readonly isBoss: boolean;
  readonly damage: number;
  readonly weakness: boolean;
  readonly hp: number;
  readonly maxHp: number;
  /** This session landed the final blow. */
  readonly defeated: boolean;
  /** Earned when this blow felled a boss; empty otherwise. */
  readonly title: string;
}

export class HuntService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: { prisma: PrismaClient; now: Clock }) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /**
   * The whole book as this player sees it, with their current hunt.
   *
   * A player who has never hunted is started on the first monster, so their very
   * first session already lands a blow instead of meeting an empty screen.
   */
  async bestiary(userId: string): Promise<Bestiary> {
    const playerLevel = await this.#playerLevel(userId);

    let active = await this.#activeHunt(userId);
    if (!active) {
      const anyHunt = await this.#prisma.monsterHunt.findFirst({ where: { userId } });
      if (!anyHunt) active = await this.#create(userId, MONSTERS[0] as MonsterDefinition);
    }
    const activeView = active ? await this.#view(active, playerLevel, userId) : null;

    const defeated = await this.#prisma.monsterHunt.findMany({
      where: { userId, status: 'DEFEATED' },
      orderBy: { endedAt: 'desc' },
    });
    const defeatsByKey = await this.#defeatsByKey(userId);

    return {
      playerLevel,
      // A hunt that ended on this read is no longer the player's active one.
      active: activeView?.status === 'ACTIVE' ? activeView : null,
      monsters: MONSTERS.map((monster) => entryFor(monster, playerLevel, defeatsByKey)),
      // Trophies are bosses: fifteen rungs of every monster would bury the shelf.
      trophies: defeated
        .filter((hunt) => isBossStage(hunt.stage))
        .map((hunt) => {
          const monster = monsterByKey(hunt.monsterKey);
          return {
            key: hunt.monsterKey,
            name: monster?.bossName ?? hunt.monsterKey,
            title: monster?.title ?? '',
            level: hunt.level,
            defeatedAt: hunt.endedAt as Date,
          };
        }),
    };
  }

  /**
   * Starts hunting a monster. Any hunt already under way is left (FLED). Choosing the
   * monster already being hunted returns that hunt unchanged.
   */
  async start(userId: string, monsterKey: string): Promise<HuntView> {
    const monster = monsterByKey(monsterKey);
    if (!monster) throw notFound('Monster not found');

    const playerLevel = await this.#playerLevel(userId);
    if (!isMonsterUnlocked(monster, playerLevel)) {
      throw unprocessable(`Bu canavar ${monster.level}. seviyede açılır.`, {
        level: monster.level,
      });
    }

    const active = await this.#activeHunt(userId);
    if (active?.monsterKey === monster.key) return this.#view(active, playerLevel, userId);

    const now = this.#now();
    if (active) {
      await this.#prisma.monsterHunt.updateMany({
        where: { id: active.id, status: 'ACTIVE' },
        data: { status: 'FLED', endedAt: now },
      });
    }
    const hunt = await this.#create(userId, monster);
    return this.#view(hunt, playerLevel, userId);
  }

  /**
   * What a just-completed session did to the hunted monster. Called after the
   * session's award has committed, so the session is already among the hunt's hits.
   * Null when the player is not hunting anything.
   */
  async afterSession(userId: string, sessionId: string): Promise<HuntSessionResult | null> {
    const active = await this.#activeHunt(userId);
    if (!active) return null;
    const view = await this.#view(active, await this.#playerLevel(userId), userId);
    const hit = view.hits.find((item) => item.sessionId === sessionId);
    if (!hit) return null;
    const defeated =
      view.status === 'DEFEATED' && view.endedAt !== null && view.endedAt.getTime() === hit.at.getTime();
    return {
      name: view.name,
      stage: view.stage,
      isBoss: view.isBoss,
      damage: hit.damage,
      weakness: hit.weakness,
      hp: view.hp,
      maxHp: view.maxHp,
      defeated,
      title: defeated && view.isBoss ? view.monster.title : '',
    };
  }

  /**
   * A hunt as it stands: its hits and HP. An ACTIVE hunt whose HP has reached zero is
   * closed here, stamped with the final blow's time — conditionally, so two concurrent
   * reads cannot close it twice.
   */
  async #view(hunt: MonsterHunt, playerLevel: number, userId: string): Promise<HuntView> {
    const monster = monsterByKey(hunt.monsterKey);
    const definition: MonsterDefinition = monster ?? {
      key: hunt.monsterKey,
      name: hunt.monsterKey,
      bossName: hunt.monsterKey,
      tagline: '',
      level: hunt.level,
      weakness: 'STR',
      title: '',
    };

    const sessions = await this.#prisma.session.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        // Flagged work stays out of anything competitive or rewarding (spec §4).
        isFlagged: false,
        xpAwarded: { gt: 0 },
        endedAt: { gte: hunt.startedAt, ...(hunt.endedAt ? { lte: hunt.endedAt } : {}) },
      },
      orderBy: { endedAt: 'asc' },
      include: { habit: { select: { name: true, category: true, stat: true } } },
    });

    let damage = 0;
    let status = hunt.status;
    let endedAt = hunt.endedAt;
    const hits: HuntHit[] = [];
    for (const session of sessions) {
      // Nothing after the final blow belongs to this hunt.
      if (status === 'DEFEATED' && endedAt !== null && damage >= hunt.maxHp) break;
      const stat = resolveStat(session.habit.category as Category, session.habit.stat as Stat | null);
      const dealt = monsterDamage(session.xpAwarded, stat, definition.weakness);
      const at = session.endedAt ?? session.createdAt;
      damage += dealt;
      hits.push({
        sessionId: session.id,
        habitName: session.habit.name,
        stat,
        damage: dealt,
        weakness: stat === definition.weakness,
        at,
      });
      if (status === 'ACTIVE' && damage >= hunt.maxHp) {
        status = 'DEFEATED';
        endedAt = at;
      }
    }

    if (status === 'DEFEATED' && hunt.status === 'ACTIVE') {
      await this.#prisma.monsterHunt.updateMany({
        where: { id: hunt.id, status: 'ACTIVE' },
        data: { status: 'DEFEATED', endedAt },
      });
    }

    const isBoss = isBossStage(hunt.stage);
    return {
      id: hunt.id,
      monster: entryFor(definition, playerLevel, await this.#defeatsByKey(userId)),
      stage: hunt.stage,
      isBoss,
      name: isBoss ? definition.bossName : definition.name,
      status,
      maxHp: hunt.maxHp,
      damage,
      hp: Math.max(0, hunt.maxHp - damage),
      startedAt: hunt.startedAt,
      endedAt,
      hits: hits.reverse(),
    };
  }

  #activeHunt(userId: string): Promise<MonsterHunt | null> {
    return this.#prisma.monsterHunt.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** Starts the next rung of a monster's ladder for this player. */
  async #create(userId: string, monster: MonsterDefinition): Promise<MonsterHunt> {
    const defeats = await this.#prisma.monsterHunt.count({
      where: { userId, monsterKey: monster.key, status: 'DEFEATED' },
    });
    const stage = nextStage(defeats);
    return this.#prisma.monsterHunt.create({
      data: {
        userId,
        monsterKey: monster.key,
        level: monster.level,
        stage,
        // Copied now, so a later rebalance cannot change a fight under way.
        maxHp: monsterMaxHp(monster.level, stage),
        startedAt: this.#now(),
      },
    });
  }

  /** How many times the player has beaten each monster, at any rung. */
  async #defeatsByKey(userId: string): Promise<Map<string, number>> {
    const groups = await this.#prisma.monsterHunt.groupBy({
      by: ['monsterKey'],
      where: { userId, status: 'DEFEATED' },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.monsterKey, group._count._all]));
  }

  /** The level derived from cycle XP — the same number the profile shows. */
  async #playerLevel(userId: string): Promise<number> {
    const user = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { cycleXp: true },
    });
    if (!user) throw notFound('User not found');
    return levelProgress(user.cycleXp).level;
  }
}

function entryFor(
  monster: MonsterDefinition,
  playerLevel: number,
  defeatsByKey: ReadonlyMap<string, number>,
): MonsterEntry {
  const defeats = defeatsByKey.get(monster.key) ?? 0;
  const stage = nextStage(defeats);
  return {
    key: monster.key,
    name: monster.name,
    bossName: monster.bossName,
    tagline: monster.tagline,
    level: monster.level,
    weakness: monster.weakness,
    title: monster.title,
    stage,
    stages: MONSTER_STAGES,
    maxHp: monsterMaxHp(monster.level, stage),
    unlocked: isMonsterUnlocked(monster, playerLevel),
    defeats,
    // Every rung below the boss beaten, plus the boss itself.
    conquered: defeats >= MONSTER_STAGES,
  };
}
