import { describe, expect, it } from 'vitest';

import { CATEGORY_DEFAULT_STAT, MAX_LEVEL, MONSTER_MIN_HP, MONSTER_STAGES } from '../balance.js';
import {
  MONSTERS,
  isBossStage,
  isMonsterUnlocked,
  monsterBaseHp,
  monsterByKey,
  monsterDamage,
  monsterMaxHp,
  nextStage,
  projectedSessionDamage,
} from '../monsters.js';

describe('the bestiary', () => {
  it('is ordered by level, from 1 to the level cap', () => {
    const levels = MONSTERS.map((monster) => monster.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels[0]).toBe(1);
    expect(levels[levels.length - 1]).toBe(MAX_LEVEL);
  });

  it('has unique keys', () => {
    expect(new Set(MONSTERS.map((monster) => monster.key)).size).toBe(MONSTERS.length);
  });

  it('only uses weaknesses a new habit can actually train', () => {
    const reachable = new Set(Object.values(CATEGORY_DEFAULT_STAT));
    for (const monster of MONSTERS) expect(reachable.has(monster.weakness), monster.name).toBe(true);
  });

  it('finds a monster by key', () => {
    expect(monsterByKey(MONSTERS[3]?.key ?? '')).toBe(MONSTERS[3]);
    expect(monsterByKey('gone')).toBeUndefined();
  });
});

describe('the ladder', () => {
  it('rises from 40% of base to full base before the boss', () => {
    const base = monsterBaseHp(20);
    expect(monsterMaxHp(20, 1)).toBe(Math.round(base * 0.4));
    expect(monsterMaxHp(20, MONSTER_STAGES - 1)).toBe(base);
    for (let stage = 2; stage < MONSTER_STAGES; stage++) {
      expect(monsterMaxHp(20, stage)).toBeGreaterThan(monsterMaxHp(20, stage - 1));
    }
  });

  it('makes the boss twice the base', () => {
    expect(isBossStage(MONSTER_STAGES)).toBe(true);
    expect(monsterMaxHp(20, MONSTER_STAGES)).toBe(monsterBaseHp(20) * 2);
  });

  it('has a floor, and stays finite at the level cap', () => {
    expect(monsterMaxHp(1, 1)).toBe(MONSTER_MIN_HP);
    expect(Number.isFinite(monsterMaxHp(MAX_LEVEL, MONSTER_STAGES))).toBe(true);
  });

  it('climbs one level per defeat and stops at the boss', () => {
    expect(nextStage(0)).toBe(1);
    expect(nextStage(4)).toBe(5);
    expect(nextStage(99)).toBe(MONSTER_STAGES);
  });

  it('gives every monster a named boss', () => {
    for (const monster of MONSTERS) expect(monster.bossName.length).toBeGreaterThan(0);
  });
});

describe('isMonsterUnlocked', () => {
  it('opens a monster at its level and not before', () => {
    const golem = monsterByKey('procrastination-golem');
    if (!golem) throw new Error('missing');
    expect(isMonsterUnlocked(golem, 4)).toBe(false);
    expect(isMonsterUnlocked(golem, 5)).toBe(true);
  });
});

describe('monsterDamage', () => {
  it('is the session XP, more against the weakness, never negative', () => {
    expect(monsterDamage(58, 'INT', 'STR')).toBe(58);
    expect(monsterDamage(58, 'INT', 'INT')).toBe(87);
    expect(monsterDamage(-5, 'INT', 'STR')).toBe(0);
  });
});

describe('projectedSessionDamage', () => {
  it('grows with time, the category\'s difficulty and focus, and the weakness', () => {
    const base = { category: 'STUDY' as const, stat: 'INT' as const, interruptions: 0, weakness: 'STR' as const };
    // 30 min x 1.15 (study) x 1.2 (uninterrupted) = 41.4 -> 41
    expect(projectedSessionDamage({ ...base, elapsedSec: 1800 })).toBe(41);
    expect(projectedSessionDamage({ ...base, elapsedSec: 1800, weakness: 'INT' })).toBe(62);
    expect(projectedSessionDamage({ ...base, elapsedSec: 0 })).toBe(0);
  });
});
