/**
 * Ready-made habits.
 *
 * Nobody should have to invent their first habit before the app does anything. The
 * catalog covers every stat a monster can be weak to, each habit already set up the
 * way it is actually done — push-ups counted, reading by the page, meditation timed —
 * so one tap adds it and the next starts it. A custom habit is still one tap away.
 *
 * Stat comes from the category's default (`CATEGORY_DEFAULT_STAT`), which is also what
 * the server assigns, so grouping by stat here groups by which monsters a habit hits.
 */

import type { Category } from '@habitwar/domain';

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
  { key: 'run', name: 'Koşu', category: 'FITNESS', kind: 'TIMED', targetMinutes: 30 },
  { key: 'gym', name: 'Ağırlık antrenmanı', category: 'FITNESS', kind: 'TIMED', targetMinutes: 45 },

  // Zekâ (INT) — Ders
  { key: 'reading', name: 'Kitap okuma', category: 'STUDY', kind: 'COUNT', targetCount: 20, unit: 'sayfa' },
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
  { key: 'drawing', name: 'Çizim', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'instrument', name: 'Enstrüman pratiği', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'writing', name: 'Yazı yazma', category: 'CREATIVE', kind: 'TIMED', targetMinutes: 30 },
  { key: 'craft', name: 'Yeni beceri', category: 'SKILL', kind: 'TIMED', targetMinutes: 30 },

  // Karizma (CHA) — Sosyal
  { key: 'call-friend', name: 'Arkadaşını ara', category: 'SOCIAL', kind: 'COUNT', targetCount: 1, unit: 'kez' },
  { key: 'family', name: 'Aileyle vakit', category: 'SOCIAL', kind: 'TIMED', targetMinutes: 30 },
  { key: 'message', name: 'Birine güzel bir mesaj', category: 'SOCIAL', kind: 'COUNT', targetCount: 3, unit: 'kez' },
];
