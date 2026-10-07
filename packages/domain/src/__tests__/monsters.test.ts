import { describe, expect, it } from 'vitest';

import { CATEGORY_DEFAULT_STAT } from '../balance.js';
import { MONSTERS, monsterByKey } from '../monsters.js';

describe('the roster', () => {
  it('has twenty monsters with unique keys and named bosses', () => {
    expect(MONSTERS).toHaveLength(20);
    expect(new Set(MONSTERS.map((monster) => monster.key)).size).toBe(MONSTERS.length);
    for (const monster of MONSTERS) expect(monster.bossName.length).toBeGreaterThan(0);
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
