/**
 * The first-run flow's "what do you want to gain?" choices.
 *
 * A new player picks goals, not habits: "move more" is a wish they already have,
 * "Şınav, 50 tekrar" is a form they would have to think about. Each goal brings the
 * ready-made habits that serve it, and always one timed habit among them — a fight is
 * fought with a timer, and the flow ends by offering the first one.
 */

import type { Stat } from '@habitwar/domain';

import type { IconName } from '../components/Icon';
import { templateByKey, type HabitTemplate } from '../habitTemplates';

export interface Goal {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** The stat its habits train — the tile's colour, and which monsters they hit hardest. */
  readonly stat: Stat;
  /** Template keys, timed first. */
  readonly templates: readonly string[];
}

export const GOALS: readonly Goal[] = [
  { key: 'move', label: 'Hareket etmek', icon: 'fitness', stat: 'STR', templates: ['workout', 'pushups'] },
  { key: 'read', label: 'Kitap okumak', icon: 'study', stat: 'INT', templates: ['reading'] },
  { key: 'focus', label: 'Odaklanmak', icon: 'hourglass', stat: 'INT', templates: ['deep-work'] },
  { key: 'calm', label: 'Zihnimi dinlendirmek', icon: 'mindfulness', stat: 'WIS', templates: ['meditation'] },
  { key: 'health', label: 'Sağlıklı yaşamak', icon: 'health', stat: 'WIS', templates: ['stretch', 'water'] },
  { key: 'learn', label: 'Yeni şey öğrenmek', icon: 'skill', stat: 'INT', templates: ['language'] },
  { key: 'create', label: 'Bir şey üretmek', icon: 'creative', stat: 'DEX', templates: ['project'] },
  { key: 'connect', label: 'Sevdiklerime vakit', icon: 'social', stat: 'CHA', templates: ['family', 'call-friend'] },
];

/** How many goals one player starts with: enough to choose, few enough to keep. */
export const MAX_GOALS = 3;

/** The templates the chosen goals bring, each once, in the order the goals were picked. */
export function templatesForGoals(goalKeys: readonly string[]): HabitTemplate[] {
  const seen = new Set<string>();
  const out: HabitTemplate[] = [];
  for (const goalKey of goalKeys) {
    const goal = GOALS.find((candidate) => candidate.key === goalKey);
    for (const templateKey of goal?.templates ?? []) {
      const template = templateByKey(templateKey);
      if (template && !seen.has(template.key)) {
        seen.add(template.key);
        out.push(template);
      }
    }
  }
  return out;
}
