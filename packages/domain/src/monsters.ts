/**
 * The bestiary: every monster, its level, its HP, and how hard a session hits it.
 *
 * Pure. The API stores which monster a player is hunting and since when; everything
 * about how the hunt goes is derived here from sessions the player already completed.
 */

import {
  DIFFICULTY_MULTIPLIER,
  MAX_LEVEL,
  MONSTER_BOSS_HP_MULTIPLIER,
  MONSTER_FIRST_STAGE_SHARE,
  MONSTER_MIN_HP,
  MONSTER_STAGES,
  MONSTER_WEAKNESS_MULTIPLIER,
} from './balance.js';
import { xpForLevel } from './leveling.js';
import { focusQualityMultiplier } from './scoring.js';
import type { Category, Stat } from './types.js';

export interface MonsterDefinition {
  /** Stable identity; the client maps it to art. */
  readonly key: string;
  readonly name: string;
  /** One line of flavour. */
  readonly tagline: string;
  /** The character level that unlocks it, and the level its HP is set from. */
  readonly level: number;
  /** Sessions training this stat hit for MONSTER_WEAKNESS_MULTIPLIER. */
  readonly weakness: Stat;
  /** Its boss form, met at the top of its ladder. */
  readonly bossName: string;
  /** The title a player earns by beating the boss. */
  readonly title: string;
}

/**
 * The bestiary, weakest first. Each monster is an enemy of good habits, and its
 * weakness is the stat that beats it, so the book nudges a player to train across
 * stats rather than grind one.
 *
 * Denser at low levels, so a new player has a choice from day one.
 *
 * Every weakness must be some category's DEFAULT stat: habits are created without a
 * stat choice, so a monster weak to END — which no category defaults to — could never
 * be hit for the bonus. The tests hold the book to this.
 */
export const MONSTERS: readonly MonsterDefinition[] = [
  { key: 'sloth-slime', name: 'Uyuşukluk Balçığı', tagline: 'Seni kanepeye yapıştırır.', level: 1, weakness: 'STR', bossName: 'Kadim Balçık', title: 'Balçık Temizleyici' },
  { key: 'notification-swarm', name: 'Bildirim Sürüsü', tagline: 'Her vızıltıda biraz daha çoğalır.', level: 2, weakness: 'WIS', bossName: 'Sürü Kraliçesi', title: 'Sessizlik Ustası' },
  { key: 'excuse-goblin', name: 'Bahane Goblini', tagline: 'Her güne yeni bir bahane bulur.', level: 3, weakness: 'CHA', bossName: 'Goblin Şefi', title: 'Goblin Avcısı' },
  { key: 'procrastination-golem', name: 'Erteleme Golemi', tagline: '"Yarın başlarsın" diye fısıldar.', level: 5, weakness: 'STR', bossName: 'Taş Dev', title: 'Golem Kıran' },
  { key: 'distraction-djinn', name: 'Dağınıklık Cini', tagline: 'Dikkatini bin parçaya böler.', level: 7, weakness: 'WIS', bossName: 'Kaos Cini', title: 'Cin Mühürleyici' },
  { key: 'forgetting-shade', name: 'Unutkanlık Gölgesi', tagline: 'Öğrendiğini sessizce siler.', level: 9, weakness: 'INT', bossName: 'Hiçlik Gölgesi', title: 'Gölge Avcısı' },
  { key: 'screen-vampire', name: 'Ekran Vampiri', tagline: 'Saatlerini sonsuz kaydırmayla emer.', level: 11, weakness: 'WIS', bossName: 'Vampir Lordu', title: 'Vampir Avcısı' },
  { key: 'rut-troll', name: 'Rutin Trolü', tagline: 'Her yolu aynı kalıba sokar.', level: 13, weakness: 'DEX', bossName: 'Trol Kral', title: 'Trol Deviren' },
  { key: 'monotony-sphinx', name: 'Monotonluk Sfenksi', tagline: 'Her günü bir öncekinin kopyası yapar.', level: 15, weakness: 'DEX', bossName: 'Büyük Sfenks', title: 'Sfenks Bilgesi' },
  { key: 'solitude-wraith', name: 'Yalnızlık Hayaleti', tagline: 'Seni herkesten uzak tutar.', level: 17, weakness: 'CHA', bossName: 'Hayalet Kraliçe', title: 'Hayalet Kovucu' },
  { key: 'laziness-ogre', name: 'Tembellik Devi', tagline: 'Ağırlığıyla her adımı yavaşlatır.', level: 20, weakness: 'STR', bossName: 'Dağ Devi', title: 'Dev Yıkan' },
  { key: 'fog-of-confusion', name: 'Kafa Karışıklığı Sisi', tagline: 'Bildiğin her şeyi bulanıklaştırır.', level: 23, weakness: 'INT', bossName: 'Fırtına Sisi', title: 'Sis Dağıtan' },
  { key: 'anxiety-serpent', name: 'Kaygı Yılanı', tagline: 'Göğsüne sarılır, nefesini keser.', level: 26, weakness: 'WIS', bossName: 'Basilisk', title: 'Yılan Terbiyecisi' },
  { key: 'perfection-statue', name: 'Kusursuzluk Heykeli', tagline: '"Daha iyi olmadan başlama" der.', level: 29, weakness: 'DEX', bossName: 'Altın Heykel', title: 'Heykel Kıran' },
  { key: 'echo-siren', name: 'Dedikodu Sireni', tagline: 'Şarkısı seni yolundan çeker.', level: 32, weakness: 'CHA', bossName: 'Siren Kraliçesi', title: 'Siren Susturan' },
  { key: 'junk-drake', name: 'Abur Cubur Ejderi', tagline: 'Gece yarısı mutfakta pusu kurar.', level: 35, weakness: 'STR', bossName: 'Kadim Ejder', title: 'Ejderha Avcısı' },
  { key: 'doubt-hydra', name: 'Şüphe Hidrası', tagline: 'Bir başını kessen iki soru doğar.', level: 38, weakness: 'INT', bossName: 'Dokuz Başlı Hidra', title: 'Hidra Avcısı' },
  { key: 'chaos-elemental', name: 'Kaos Elementali', tagline: 'Düzen kurduğun her yeri dağıtır.', level: 42, weakness: 'DEX', bossName: 'Kaos Titanı', title: 'Düzen Bekçisi' },
  { key: 'quitting-king', name: 'Vazgeçiş Kralı', tagline: 'Taht odası yarım kalmış hedeflerle dolu.', level: 46, weakness: 'CHA', bossName: 'Vazgeçiş İmparatoru', title: 'Kral Deviren' },
  { key: 'habit-devourer', name: 'Alışkanlık Yiyen', tagline: 'Tüm kötü alışkanlıkların kaynağı.', level: 50, weakness: 'INT', bossName: 'Sonsuz Yiyen', title: 'Efsane' },
];

/** Looks a monster up by key; undefined for a key no longer in the book. */
export function monsterByKey(key: string): MonsterDefinition | undefined {
  return MONSTERS.find((monster) => monster.key === key);
}

/** A monster's base HP: the XP its unlock level takes to clear. */
export function monsterBaseHp(level: number): number {
  const clamped = Math.min(MAX_LEVEL - 1, Math.max(1, Math.floor(level)));
  return xpForLevel(clamped);
}

/** Clamps a ladder level into 1..MONSTER_STAGES. */
export function clampStage(stage: number): number {
  return Math.min(MONSTER_STAGES, Math.max(1, Math.floor(stage)));
}

/** True for the top of the ladder: the boss. */
export function isBossStage(stage: number): boolean {
  return clampStage(stage) === MONSTER_STAGES;
}

/**
 * HP of a monster at one level of its ladder: 40% of base at level 1, rising evenly to
 * the full base just before the boss, and the boss at MONSTER_BOSS_HP_MULTIPLIER x.
 */
export function monsterMaxHp(unlockLevel: number, stage = MONSTER_STAGES - 1): number {
  const base = monsterBaseHp(unlockLevel);
  const at = clampStage(stage);
  const share = isBossStage(at)
    ? MONSTER_BOSS_HP_MULTIPLIER
    : MONSTER_FIRST_STAGE_SHARE +
      ((1 - MONSTER_FIRST_STAGE_SHARE) * (at - 1)) / Math.max(1, MONSTER_STAGES - 2);
  return Math.max(MONSTER_MIN_HP, Math.round(base * share));
}

/** The ladder level a player fights next, from how many times they beat the monster. */
export function nextStage(defeats: number): number {
  return clampStage(defeats + 1);
}

/** Whether a player at `playerLevel` may hunt this monster. */
export function isMonsterUnlocked(monster: MonsterDefinition, playerLevel: number): boolean {
  return monster.level <= playerLevel;
}

/** Damage one session deals: the XP it earned, more against the monster's weakness. */
export function monsterDamage(xp: number, stat: Stat, weakness: Stat): number {
  const base = Math.max(0, Math.round(xp));
  return stat === weakness ? Math.round(base * MONSTER_WEAKNESS_MULTIPLIER) : base;
}

/**
 * A running session's damage so far, for the live HP bar on the timer screen.
 *
 * An ESTIMATE, and labelled as one in the UI: credited minutes x the category's
 * difficulty x the focus multiplier, then the weakness bonus. The real hit is the XP
 * the server awards at completion, which also weighs streak, season, class and daily
 * caps — none of which change second to second, so they are left out of the readout.
 */
export function projectedSessionDamage(input: {
  readonly elapsedSec: number;
  readonly category: Category;
  readonly stat: Stat;
  readonly interruptions: number;
  readonly weakness: Stat;
}): number {
  const minutes = Math.max(0, input.elapsedSec) / 60;
  const xp =
    minutes * (DIFFICULTY_MULTIPLIER[input.category] ?? 1) * focusQualityMultiplier(input.interruptions);
  return monsterDamage(Math.floor(xp), input.stat, input.weakness);
}
