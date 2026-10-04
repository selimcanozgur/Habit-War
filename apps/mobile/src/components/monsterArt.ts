/**
 * Each monster's emblem: the thing it does to a habit. Icons stand in for art until
 * the bestiary gets illustrations; the key is the stable link between the two.
 */

import type { IconName } from './Icon';

export const MONSTER_ICONS: Readonly<Record<string, IconName>> = {
  'sloth-slime': 'clock',
  'notification-swarm': 'bell',
  'excuse-goblin': 'comment',
  'procrastination-golem': 'hourglass',
  'distraction-djinn': 'compass',
  'forgetting-shade': 'cloud-off',
  'screen-vampire': 'eye',
  'rut-troll': 'repeat',
  'monotony-sphinx': 'bar-chart',
  'solitude-wraith': 'user',
  'laziness-ogre': 'fitness',
  'fog-of-confusion': 'search',
  'anxiety-serpent': 'heart',
  'perfection-statue': 'star',
  'echo-siren': 'headset',
  'junk-drake': 'flame',
  'doubt-hydra': 'info',
  'chaos-elemental': 'xp-bolt',
  'quitting-king': 'medal',
  'habit-devourer': 'swords',
};

export function monsterIcon(key: string): IconName {
  return MONSTER_ICONS[key] ?? 'swords';
}
