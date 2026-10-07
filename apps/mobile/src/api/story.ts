/**
 * The story: the player's place on the road and what each session did to it.
 *
 * The server derives the position from completed sessions; the battle screen runs the
 * same domain function (`advanceStory`) on the live session from this position, so
 * the two never disagree.
 */

import type { Stat, StoryPosition } from '@habitwar/domain';

import { apiRequest } from './client';

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
  readonly completedAt: string;
}

export interface StoryState {
  readonly startedAt: string;
  readonly position: StoryPosition;
  readonly finished: boolean;
  readonly current: CurrentFight | null;
  readonly completed: readonly ChapterCompleted[];
}

export interface FightWonView {
  readonly chapter: number;
  readonly fight: number;
  readonly isBoss: boolean;
  readonly name: string;
  /** Earned when the fight was a boss; empty otherwise. */
  readonly title: string;
}

/** What one completed session did to the story; part of the completion response. */
export interface StorySessionResult {
  readonly damage: number;
  readonly won: readonly FightWonView[];
  readonly current: CurrentFight | null;
}

export function getStory(): Promise<{ story: StoryState }> {
  return apiRequest('/v1/story');
}
