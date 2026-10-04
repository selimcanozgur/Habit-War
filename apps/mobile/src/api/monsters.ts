/**
 * The bestiary and the player's hunt.
 *
 * Sessions hit the hunted monster on the server; the client reads the fight and
 * chooses which monster to hunt next.
 */

import type { Stat } from '@habitwar/domain';

import { apiRequest } from './client';

export interface MonsterEntry {
  readonly key: string;
  readonly name: string;
  /** Its boss form, at the top of its ladder. */
  readonly bossName: string;
  readonly tagline: string;
  /** The player level that unlocks it. */
  readonly level: number;
  readonly weakness: Stat;
  /** Paid for beating its boss. */
  readonly title: string;
  /** The ladder level the player fights next. */
  readonly stage: number;
  readonly stages: number;
  /** HP of the next fight. */
  readonly maxHp: number;
  readonly unlocked: boolean;
  /** Times beaten, at any level. */
  readonly defeats: number;
  /** Its boss has fallen to this player. */
  readonly conquered: boolean;
}

export interface HuntHit {
  readonly sessionId: string;
  readonly habitName: string;
  readonly stat: Stat;
  readonly damage: number;
  readonly weakness: boolean;
  readonly at: string;
}

export interface Hunt {
  readonly id: string;
  readonly monster: MonsterEntry;
  readonly stage: number;
  readonly isBoss: boolean;
  /** The monster's name, or its boss's. */
  readonly name: string;
  readonly status: 'ACTIVE' | 'DEFEATED' | 'FLED';
  readonly maxHp: number;
  readonly damage: number;
  readonly hp: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly hits: readonly HuntHit[];
}

export interface Trophy {
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly level: number;
  readonly defeatedAt: string;
}

export interface Bestiary {
  readonly playerLevel: number;
  readonly active: Hunt | null;
  readonly monsters: readonly MonsterEntry[];
  readonly trophies: readonly Trophy[];
}

/** What one completed session did to the hunted monster; part of the completion response. */
export interface HuntSessionResult {
  readonly name: string;
  readonly stage: number;
  readonly isBoss: boolean;
  readonly damage: number;
  readonly weakness: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly defeated: boolean;
  readonly title: string;
}

export function getBestiary(): Promise<Bestiary> {
  return apiRequest('/v1/monsters');
}

/** Starts hunting a monster; the hunt under way, if any, is left behind. */
export function startHunt(monsterKey: string): Promise<{ hunt: Hunt }> {
  return apiRequest(`/v1/monsters/${monsterKey}/hunt`, { method: 'POST', body: {} });
}
