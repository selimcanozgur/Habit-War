/**
 * Visual tokens.
 *
 * Dark by default: the product is about evenings and focus sessions, and a bright
 * screen is the wrong thing to hand someone who just sat down to read or meditate.
 *
 * Stat colours are fixed per stat so a stat keeps the same identity everywhere it
 * appears — timer ring, radar chart, feed post.
 */

import type { Stat } from '@habitwar/domain';

export const colors = {
  bg: '#0B0D14',
  surface: '#141824',
  surfaceRaised: '#1C2130',
  border: '#252B3B',

  text: '#E8EAF2',
  textMuted: '#8D94AB',
  textFaint: '#5A6178',

  accent: '#6366F1',
  accentBright: '#818CF8',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const;

export const statColors: Readonly<Record<Stat, string>> = {
  STR: '#EF4444',
  END: '#F97316',
  INT: '#6366F1',
  WIS: '#10B981',
  CHA: '#EC4899',
  DEX: '#F59E0B',
};

export const statLabels: Readonly<Record<Stat, string>> = {
  STR: 'Güç',
  END: 'Dayanıklılık',
  INT: 'Zekâ',
  WIS: 'Bilgelik',
  CHA: 'Karizma',
  DEX: 'Beceri',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const type = {
  /** Timer readout. Tabular figures stop the layout jittering as digits change. */
  timer: {
    fontSize: 64,
    fontWeight: '200' as const,
    // Not `as const`: RN's TextStyle wants a mutable FontVariant[].
    fontVariant: ['tabular-nums'] as ('tabular-nums')[],
  },
  title: { fontSize: 24, fontWeight: '700' as const },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 11, fontWeight: '500' as const },
} as const;
