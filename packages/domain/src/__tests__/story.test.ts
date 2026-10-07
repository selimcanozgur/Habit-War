import { describe, expect, it } from 'vitest';

import { MAX_SESSION_MINUTES } from '../balance.js';
import { MONSTERS } from '../monsters.js';
import {
  STORY_CHAPTERS,
  STORY_START,
  advanceStory,
  chapterBaseMinutes,
  chapterMonster,
  fightMaxHp,
  focusLevel,
  isBossFight,
  isStoryFinished,
  storySeconds,
} from '../story.js';

// Chapter 1's monster is weak to STR; INT is a neutral stat for it.
const NEUTRAL = 'INT' as const;
const WEAK = 'STR' as const;

describe('the HP table (game-design.md §3.2)', () => {
  it('runs from 5 to 45 base minutes', () => {
    expect(chapterBaseMinutes(1)).toBe(5);
    expect(chapterBaseMinutes(5)).toBe(13);
    expect(chapterBaseMinutes(10)).toBe(24);
    expect(chapterBaseMinutes(15)).toBe(34);
    expect(chapterBaseMinutes(20)).toBe(45);
  });

  it('sets fights at x1, x1.5, x2 and the boss at x4, in seconds', () => {
    expect([1, 2, 3, 4].map((fight) => fightMaxHp(1, fight))).toEqual([300, 450, 600, 1200]);
    expect(fightMaxHp(20, 4)).toBe(10800);
    expect(isBossFight(4)).toBe(true);
    expect(isBossFight(3)).toBe(false);
  });

  it('meets the chapters in roster order', () => {
    expect(STORY_CHAPTERS).toBe(MONSTERS.length);
    expect(chapterMonster(2)).toBe(MONSTERS[1]);
  });
});

describe('advanceStory', () => {
  it('deals one damage per second', () => {
    const result = advanceStory(STORY_START, 120, NEUTRAL);
    expect(result.position).toEqual({ chapter: 1, fight: 1, damage: 120 });
    expect(result.damage).toBe(120);
    expect(result.won).toEqual([]);
  });

  it('deals one and a half against the weakness, in whole damage', () => {
    expect(advanceStory(STORY_START, 101, WEAK).position.damage).toBe(151);
  });

  it('wins a fight the moment its HP is spent and spills the rest over', () => {
    const result = advanceStory(STORY_START, 400, NEUTRAL);
    expect(result.won).toEqual([{ chapter: 1, fight: 1, isBoss: false }]);
    expect(result.position).toEqual({ chapter: 1, fight: 2, damage: 100 });
    expect(result.damage).toBe(400);
  });

  it('beats the boss and moves on to the next chapter', () => {
    const before = { chapter: 1, fight: 4, damage: 1100 };
    const result = advanceStory(before, 160, NEUTRAL);
    expect(result.won).toEqual([{ chapter: 1, fight: 4, isBoss: true }]);
    expect(result.position).toEqual({ chapter: 2, fight: 1, damage: 60 });
  });

  it('weighs a spill-over against the next monster\'s weakness', () => {
    // STR is chapter 1's weakness but not chapter 2's (WIS).
    const before = { chapter: 1, fight: 4, damage: 1200 - 3 };
    const result = advanceStory(before, 10, WEAK);
    // 3 HP left at 1.5/s takes 2 seconds; the other 8 hit chapter 2 at 1/s.
    expect(result.position).toEqual({ chapter: 2, fight: 1, damage: 8 });
  });

  it('is the same however a stretch of work is split into sessions', () => {
    const whole = advanceStory(STORY_START, 5000, NEUTRAL).position;
    let split = STORY_START;
    for (const seconds of [700, 1300, 1000, 2000]) split = advanceStory(split, seconds, NEUTRAL).position;
    expect(split).toEqual(whole);
  });

  it('stops at the end of the story', () => {
    const last = { chapter: STORY_CHAPTERS, fight: 4, damage: 0 };
    const result = advanceStory(last, 999_999, NEUTRAL);
    expect(isStoryFinished(result.position)).toBe(true);
    expect(result.won).toHaveLength(1);
    expect(advanceStory(result.position, 500, NEUTRAL).damage).toBe(0);
  });
});

describe('storySeconds', () => {
  it('credits active time, capped at the session maximum', () => {
    expect(storySeconds(754.9)).toBe(754);
    expect(storySeconds(MAX_SESSION_MINUTES * 60 + 999)).toBe(MAX_SESSION_MINUTES * 60);
    expect(storySeconds(-5)).toBe(0);
  });
});

describe('focusLevel', () => {
  it('maps the XP focus tiers onto a four-step bar that never empties', () => {
    expect(focusLevel(0)).toBe(4);
    expect(focusLevel(1)).toBe(3);
    expect(focusLevel(2)).toBe(3);
    expect(focusLevel(3)).toBe(2);
    expect(focusLevel(5)).toBe(2);
    expect(focusLevel(6)).toBe(1);
    expect(focusLevel(99)).toBe(1);
  });
});
