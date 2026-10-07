/**
 * The monsters of the story, in the order the story meets them: chapter N is fought
 * against MONSTERS[N - 1], and its fourth fight is the monster's boss form.
 *
 * Every weakness must be some category's DEFAULT stat: habits are created without a
 * stat choice, so a monster weak to END — which no category defaults to — could never
 * be hit for the bonus. The tests hold the roster to this.
 */

import type { Stat } from './types.js';

export interface MonsterDefinition {
  /** Stable identity; the client maps it to art. */
  readonly key: string;
  readonly name: string;
  /** Its boss form: the fourth fight of its chapter. */
  readonly bossName: string;
  /** One line of flavour. */
  readonly tagline: string;
  /** Sessions training this stat deal WEAKNESS_DAMAGE_MULTIPLIER per second. */
  readonly weakness: Stat;
  /** The title a player earns by beating the boss. */
  readonly title: string;
}

export const MONSTERS: readonly MonsterDefinition[] = [
  { key: 'sloth-slime', name: 'Uyuşukluk Balçığı', bossName: 'Kadim Balçık', tagline: 'Seni kanepeye yapıştırır.', weakness: 'STR', title: 'Balçık Temizleyici' },
  { key: 'notification-swarm', name: 'Bildirim Sürüsü', bossName: 'Sürü Kraliçesi', tagline: 'Her vızıltıda biraz daha çoğalır.', weakness: 'WIS', title: 'Sessizlik Ustası' },
  { key: 'excuse-goblin', name: 'Bahane Goblini', bossName: 'Goblin Şefi', tagline: 'Her güne yeni bir bahane bulur.', weakness: 'CHA', title: 'Goblin Avcısı' },
  { key: 'procrastination-golem', name: 'Erteleme Golemi', bossName: 'Taş Dev', tagline: '"Yarın başlarsın" diye fısıldar.', weakness: 'STR', title: 'Golem Kıran' },
  { key: 'distraction-djinn', name: 'Dağınıklık Cini', bossName: 'Kaos Cini', tagline: 'Dikkatini bin parçaya böler.', weakness: 'WIS', title: 'Cin Mühürleyici' },
  { key: 'forgetting-shade', name: 'Unutkanlık Gölgesi', bossName: 'Hiçlik Gölgesi', tagline: 'Öğrendiğini sessizce siler.', weakness: 'INT', title: 'Gölge Avcısı' },
  { key: 'screen-vampire', name: 'Ekran Vampiri', bossName: 'Vampir Lordu', tagline: 'Saatlerini sonsuz kaydırmayla emer.', weakness: 'WIS', title: 'Vampir Avcısı' },
  { key: 'rut-troll', name: 'Rutin Trolü', bossName: 'Trol Kral', tagline: 'Her yolu aynı kalıba sokar.', weakness: 'DEX', title: 'Trol Deviren' },
  { key: 'monotony-sphinx', name: 'Monotonluk Sfenksi', bossName: 'Büyük Sfenks', tagline: 'Her günü bir öncekinin kopyası yapar.', weakness: 'DEX', title: 'Sfenks Bilgesi' },
  { key: 'solitude-wraith', name: 'Yalnızlık Hayaleti', bossName: 'Hayalet Kraliçe', tagline: 'Seni herkesten uzak tutar.', weakness: 'CHA', title: 'Hayalet Kovucu' },
  { key: 'laziness-ogre', name: 'Tembellik Devi', bossName: 'Dağ Devi', tagline: 'Ağırlığıyla her adımı yavaşlatır.', weakness: 'STR', title: 'Dev Yıkan' },
  { key: 'fog-of-confusion', name: 'Kafa Karışıklığı Sisi', bossName: 'Fırtına Sisi', tagline: 'Bildiğin her şeyi bulanıklaştırır.', weakness: 'INT', title: 'Sis Dağıtan' },
  { key: 'anxiety-serpent', name: 'Kaygı Yılanı', bossName: 'Basilisk', tagline: 'Göğsüne sarılır, nefesini keser.', weakness: 'WIS', title: 'Yılan Terbiyecisi' },
  { key: 'perfection-statue', name: 'Kusursuzluk Heykeli', bossName: 'Altın Heykel', tagline: '"Daha iyi olmadan başlama" der.', weakness: 'DEX', title: 'Heykel Kıran' },
  { key: 'echo-siren', name: 'Dedikodu Sireni', bossName: 'Siren Kraliçesi', tagline: 'Şarkısı seni yolundan çeker.', weakness: 'CHA', title: 'Siren Susturan' },
  { key: 'junk-drake', name: 'Abur Cubur Ejderi', bossName: 'Kadim Ejder', tagline: 'Gece yarısı mutfakta pusu kurar.', weakness: 'STR', title: 'Ejderha Avcısı' },
  { key: 'doubt-hydra', name: 'Şüphe Hidrası', bossName: 'Dokuz Başlı Hidra', tagline: 'Bir başını kessen iki soru doğar.', weakness: 'INT', title: 'Hidra Avcısı' },
  { key: 'chaos-elemental', name: 'Kaos Elementali', bossName: 'Kaos Titanı', tagline: 'Düzen kurduğun her yeri dağıtır.', weakness: 'DEX', title: 'Düzen Bekçisi' },
  { key: 'quitting-king', name: 'Vazgeçiş Kralı', bossName: 'Vazgeçiş İmparatoru', tagline: 'Taht odası yarım kalmış hedeflerle dolu.', weakness: 'CHA', title: 'Kral Deviren' },
  { key: 'habit-devourer', name: 'Alışkanlık Yiyen', bossName: 'Sonsuz Yiyen', tagline: 'Tüm kötü alışkanlıkların kaynağı.', weakness: 'INT', title: 'Efsane' },
];

/** Looks a monster up by key; undefined for a key no longer in the roster. */
export function monsterByKey(key: string): MonsterDefinition | undefined {
  return MONSTERS.find((monster) => monster.key === key);
}
