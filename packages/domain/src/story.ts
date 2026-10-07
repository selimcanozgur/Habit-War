/**
 * The story's battle rules (docs/game-design.md §2–3). Pure, and shared by the server
 * and the app, so the live battle screen and the server's result are the same number.
 *
 * The story is a fixed road: chapter 1..STORY_CHAPTERS, each with FIGHTS_PER_CHAPTER
 * fights (three against the chapter's monster, then its boss). A player's position on
 * the road is never stored as such — it is the result of feeding every story session,
 * in order, through `advanceStory`. Damage spills over: when a fight ends mid-session,
 * the remaining seconds hit the next fight, so worked time is never wasted.
 */

import {
  FIGHTS_PER_CHAPTER,
  FIGHT_TIME_MULTIPLIERS,
  FOCUS_QUALITY_TIERS,
  MAX_SESSION_MINUTES,
  STORY_FIRST_BASE_MINUTES,
  STORY_LAST_BASE_MINUTES,
  WEAKNESS_DAMAGE_MULTIPLIER,
} from './balance.js';
import { MONSTERS, type MonsterDefinition } from './monsters.js';
import type { Stat } from './types.js';

export const STORY_CHAPTERS = MONSTERS.length;

/** Where a player stands: the fight under way and the damage already dealt to it. */
export interface StoryPosition {
  /** 1..STORY_CHAPTERS, or STORY_CHAPTERS + 1 once the story is finished. */
  readonly chapter: number;
  /** 1..FIGHTS_PER_CHAPTER; the last is the boss. */
  readonly fight: number;
  /** Damage dealt to the current fight so far. */
  readonly damage: number;
}

export const STORY_START: StoryPosition = { chapter: 1, fight: 1, damage: 0 };

/** One fight won while advancing. */
export interface FightWon {
  readonly chapter: number;
  readonly fight: number;
  readonly isBoss: boolean;
}

/** The monster of a chapter (1-based). */
export function chapterMonster(chapter: number): MonsterDefinition {
  const monster = MONSTERS[Math.min(STORY_CHAPTERS, Math.max(1, chapter)) - 1];
  if (!monster) throw new RangeError(`chapterMonster: no chapter ${chapter}`);
  return monster;
}

/** Base fight length of a chapter in minutes: 5 for the first, 45 for the last. */
export function chapterBaseMinutes(chapter: number): number {
  const steps = Math.max(1, STORY_CHAPTERS - 1);
  const at = Math.min(STORY_CHAPTERS, Math.max(1, chapter)) - 1;
  return Math.round(
    STORY_FIRST_BASE_MINUTES + (at * (STORY_LAST_BASE_MINUTES - STORY_FIRST_BASE_MINUTES)) / steps,
  );
}

/** HP of one fight: its length in seconds (1 damage = 1 worked second). */
export function fightMaxHp(chapter: number, fight: number): number {
  const multiplier = FIGHT_TIME_MULTIPLIERS[Math.min(FIGHTS_PER_CHAPTER, Math.max(1, fight)) - 1] ?? 1;
  return Math.round(chapterBaseMinutes(chapter) * multiplier * 60);
}

export function isBossFight(fight: number): boolean {
  return fight === FIGHTS_PER_CHAPTER;
}

export function isStoryFinished(position: StoryPosition): boolean {
  return position.chapter > STORY_CHAPTERS;
}

/** Damage per second a session training `stat` deals to `monster`. */
export function damageRate(stat: Stat, monster: MonsterDefinition): number {
  return stat === monster.weakness ? WEAKNESS_DAMAGE_MULTIPLIER : 1;
}

/** Seconds of a session the story credits: its active time, capped like XP. */
export function storySeconds(durationSec: number): number {
  return Math.min(Math.max(0, Math.floor(durationSec)), MAX_SESSION_MINUTES * 60);
}

export interface AdvanceResult {
  readonly position: StoryPosition;
  /** Damage dealt across every fight this advance touched. */
  readonly damage: number;
  readonly won: readonly FightWon[];
}

/**
 * Feeds `seconds` of work training `stat` into the story from `from`.
 *
 * Each fight takes damage at its own monster's rate — a spill-over into the next
 * chapter is weighed against the next monster's weakness — and a fight is won the
 * moment its HP is spent. Whole damage only: a partial second's damage is dropped at
 * the end, never carried, so replaying the same seconds always lands on the same
 * position.
 */
export function advanceStory(from: StoryPosition, seconds: number, stat: Stat): AdvanceResult {
  let { chapter, fight, damage } = from;
  let left = Math.max(0, Math.floor(seconds));
  let dealt = 0;
  const won: FightWon[] = [];

  while (left > 0 && chapter <= STORY_CHAPTERS) {
    const rate = damageRate(stat, chapterMonster(chapter));
    const remaining = fightMaxHp(chapter, fight) - damage;
    const secondsToWin = Math.ceil(remaining / rate);

    if (left >= secondsToWin) {
      left -= secondsToWin;
      dealt += remaining;
      won.push({ chapter, fight, isBoss: isBossFight(fight) });
      damage = 0;
      if (fight < FIGHTS_PER_CHAPTER) {
        fight += 1;
      } else {
        chapter += 1;
        fight = 1;
      }
    } else {
      const hit = Math.floor(left * rate);
      damage += hit;
      dealt += hit;
      left = 0;
    }
  }

  return { position: { chapter, fight, damage }, damage: dealt, won };
}

/**
 * The focus bar's level, 4 (full) to 1, from a session's interruptions. It is the
 * XP focus multiplier made visible — one bar step per FOCUS_QUALITY_TIERS tier — and
 * never empties: focus costs XP bonus, never the fight.
 */
export function focusLevel(interruptions: number): number {
  const count = Math.max(0, Math.floor(interruptions));
  const tier = FOCUS_QUALITY_TIERS.findIndex(([max]) => count <= max);
  const index = tier === -1 ? FOCUS_QUALITY_TIERS.length - 1 : tier;
  return Math.max(1, FOCUS_QUALITY_TIERS.length - index);
}
