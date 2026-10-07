/**
 * Ready-made habits.
 *
 * Nobody should have to invent their first habit before the app does anything. The
 * catalog covers every stat a monster can be weak to, each habit already set up the
 * way it is actually done — push-ups counted, reading and meditation timed — so one
 * tap adds it and the next starts it. A custom habit is still one tap away.
 *
 * Every stat has at least one timed habit: a fight is fought with a timer, and the
 * first-run flow (app/onboarding.tsx) promises each goal a habit to fight with.
 *
 * Stat comes from the category's default (`CATEGORY_DEFAULT_STAT`), which is also what
 * the server assigns, so grouping by stat here groups by which monsters a habit hits.
 */

import type { Category } from '@habitwar/domain';

import type { createHabit } from './api/sessions';

export interface HabitTemplate {
  readonly key: string;
  readonly name: string;
  readonly category: Category;
  readonly kind: 'TIMED' | 'COUNT';
  /** TIMED: the daily target in minutes. */
  readonly targetMinutes?: number;
  /** COUNT: the daily target and what is counted. */
  readonly targetCount?: number;
  readonly unit?: string;
}

export const HABIT_TEMPLATES: readonly HabitTemplate[] = [
  // Güç (STR) — Spor
  { key: 'pushups', name: 'Şınav', category: 'FITNESS', kind: 'COUNT', targetCount: 50, unit: 'tekrar' },
  { key: 'situps', name: 'Mekik', category: 'FITNESS', kind: 'COUNT', targetCount: 50, unit: 'tekrar' },
  { key: 'squats', name: 'Squat', category: 'FITNESS', kind: 'COUNT', targetCount: 50, unit: 'tekrar' },
  { key: 'walk', name: 'Yürüyüş', category: 'FITNESS', kind: 'COUNT', targetCount: 5, unit: 'km' },
  { key: 'workout', name: 'Ev egzersizi', category: 'FITNESS', kind: 'TIMED', targetMinutes: 15 },
  { key: 'run', name: 'Koşu', category: 'FITNESS', kind: 'TIMED', targetMinutes: 30 },
  { key: 'gym', name: 'Ağırlık antrenmanı', category: 'FITNESS', kind: 'TIMED', targetMinutes: 45 },

  // Zekâ (INT) — Ders
  { key: 'reading', name: 'Kitap okuma', category: 'STUDY', kind: 'TIMED', targetMinutes: 20 },
  { key: 'deep-work', name: 'Odaklı çalışma', category: 'STUDY', kind: 'TIMED', targetMinutes: 25 },
  { key: 'study', name: 'Ders çalışma', category: 'STUDY', kind: 'TIMED', targetMinutes: 45 },
  { key: 'language', name: 'Yabancı dil', category: 'STUDY', kind: 'TIMED', targetMinutes: 20 },
  { key: 'coding', name: 'Kodlama pratiği', category: 'STUDY', kind: 'TIMED', targetMinutes: 45 },

  // Bilgelik (WIS) — Zihin, Sağlık
  { key: 'meditation', name: 'Meditasyon', category: 'MINDFULNESS', kind: 'TIMED', targetMinutes: 10 },
  { key: 'breathing', name: 'Nefes egzersizi', category: 'MINDFULNESS', kind: 'TIMED', targetMinutes: 5 },
  { key: 'journal', name: 'Günlük yazma', category: 'MINDFULNESS', kind: 'TIMED', targetMinutes: 10 },
  { key: 'water', name: 'Su içme', category: 'HEALTH', kind: 'COUNT', targetCount: 8, unit: 'bardak' },
  { key: 'stretch', name: 'Esneme', category: 'HEALTH', kind: 'TIMED', targetMinutes: 10 },

  // Beceri (DEX) — Yaratıcılık, Beceri
  { key: 'project', name: 'Kendi projem', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'drawing', name: 'Çizim', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'instrument', name: 'Enstrüman pratiği', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'writing', name: 'Yazı yazma', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'craft', name: 'Yeni beceri', category: 'SKILL', kind: 'TIMED', targetMinutes: 30 },

  // Karizma (CHA) — Sosyal
  { key: 'call-friend', name: 'Arkadaşını ara', category: 'SOCIAL', kind: 'COUNT', targetCount: 1, unit: 'kez' },
  { key: 'family', name: 'Aileyle vakit', category: 'SOCIAL', kind: 'TIMED', targetMinutes: 30 },
  { key: 'message', name: 'Birine güzel bir mesaj', category: 'SOCIAL', kind: 'COUNT', targetCount: 3, unit: 'kez' },
];

export function templateByKey(key: string): HabitTemplate | undefined {
  return HABIT_TEMPLATES.find((template) => template.key === key);
}

/** The create-habit request a template stands for. */
export function templateHabitInput(template: HabitTemplate): Parameters<typeof createHabit>[0] {
  return template.kind === 'COUNT'
    ? {
        name: template.name,
        category: template.category,
        // Fixed server-side for count habits; the field is required.
        targetMinutes: 15,
        kind: 'COUNT',
        targetCount: template.targetCount ?? 1,
        unit: template.unit ?? 'kez',
      }
    : { name: template.name, category: template.category, targetMinutes: template.targetMinutes ?? 30 };
}
