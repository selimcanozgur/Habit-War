/**
 * Visual tokens.
 *
 * The language is a parchment RPG: warm aged-paper cards on dark stone, with the
 * saturated colours reserved for the things a player tracks — XP, fire, gold,
 * completion. It suits the product because the spec's whole premise is that a level
 * is earned rather than displayed, and paper reads as a record where a flat white
 * card reads as a form.
 *
 * Two grounds, used deliberately:
 *  - Cards, sheets and anything holding content sit on PARCHMENT.
 *  - The tab bar, hero overlays and RPG panels sit on STONE.
 * Text colour follows the ground, never the other way round.
 *
 * Every screen reads from these names. Changing a value here re-skins the app, which
 * is why nothing below is repeated in a StyleSheet.
 */

import type { Stat } from '@habitwar/domain';

export const colors = {
  /** Page ground behind the cards. Dark, so parchment reads as lit. */
  bg: '#1D2A35',
  /** Darkest surface: tab bar, bottom sheets, overlay panels. */
  stone: '#1E1E1C',
  /** The RPG panel — a season banner, a duel board. */
  panel: '#1D2A35',
  /** Wood and stone framing between a dark panel and its content. */
  frame: '#413425',

  /** Card ground. The app's main reading surface. */
  surface: '#F8E3C2',
  /** A recess inside a card: a progress track, an empty slot, a stat strip. */
  surfaceRaised: '#EBCDA1',
  /** Deeper recess, for a track that must read as cut into the page. */
  surfaceSunken: '#DCBA8B',

  /** Card edge. Warm, never grey — grey on parchment reads as dirt. */
  border: '#D9B681',
  borderStrong: '#B9915C',

  /** Ink on parchment. */
  text: '#2A2118',
  textMuted: '#6B5744',
  textFaint: '#9C8769',
  /** Text on any dark ground — stone, panel, hero overlay. */
  textOnDark: '#F2F5F7',
  textOnDarkMuted: '#B9C3CB',
  /** Text on a saturated fill. */
  textOnAccent: '#FFFFFF',

  /** Primary. Every "go" action and every icon that is not a status. */
  accent: '#2072BB',
  accentDark: '#155690',
  accentBright: '#3F95D2',
  accentSoft: '#DCEAF6',

  /** XP and anything magical: progress bars, level badges, the duel bar. */
  xp: '#9B5EF9',
  xpDark: '#7A3FD6',
  xpSoft: '#EDE2FE',

  /** Done, complete, ahead. Never a call to action. */
  success: '#30AF29',
  successDark: '#248420',
  successSoft: '#E1F4DF',

  /** Streaks, energy, fire. Warmth, not alarm. */
  fire: '#E37537',
  fireDark: '#BC5A24',
  fireSoft: '#FBE7DA',

  /** Rewards, rank, rarity. */
  gold: '#D2AE78',
  goldDark: '#A8854F',
  goldSoft: '#F6EBD9',

  danger: '#C4452F',
  dangerDark: '#9A3423',
  dangerSoft: '#F7DFDA',
} as const;

/**
 * Stat colours.
 *
 * Fixed per stat so a stat keeps one identity everywhere it appears — the bar on the
 * profile, the disc on a habit row, the chip in a session reward.
 */
export const statColors: Readonly<Record<Stat, string>> = {
  STR: '#C4452F',
  END: '#E37537',
  INT: '#2072BB',
  WIS: '#30AF29',
  CHA: '#C44E8E',
  DEX: '#9B5EF9',
};

export const statLabels: Readonly<Record<Stat, string>> = {
  STR: 'Güç',
  END: 'Dayanıklılık',
  INT: 'Zekâ',
  WIS: 'Bilgelik',
  CHA: 'Karizma',
  DEX: 'Beceri',
};

/** Habit category to the colour of its disc. */
export const categoryColors: Readonly<Record<string, string>> = {
  FITNESS: '#C4452F',
  STUDY: '#2072BB',
  MINDFULNESS: '#30AF29',
  CREATIVE: '#9B5EF9',
  SOCIAL: '#E37537',
  HEALTH: '#C44E8E',
  SKILL: '#D2AE78',
};

export const categoryLabels: Readonly<Record<string, string>> = {
  FITNESS: 'Spor',
  STUDY: 'Ders',
  MINDFULNESS: 'Zihin',
  CREATIVE: 'Yaratıcılık',
  SOCIAL: 'Sosyal',
  HEALTH: 'Sağlık',
  SKILL: 'Beceri',
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
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

/**
 * The depth of a control's bottom edge.
 *
 * A solid control sits on a darker slab of itself and compresses into it on press.
 * It reads as physical in a way a shadow does not, and on a warm ground a soft grey
 * shadow just looks like a smudge.
 */
export const depth = {
  button: 4,
  card: 3,
} as const;

/**
 * Height of the illustrated header each screen opens with.
 *
 * Tall enough to establish the world, short enough that the first card is visible
 * without scrolling on a small handset.
 */
export const heroHeight = 190;

/**
 * Height for a hero that carries the character banner rather than a title alone.
 *
 * The banner stacks a name, a class, a level line, an XP bar and three badges. At
 * `heroHeight` they crowd the top of the illustration and cover the figure the art
 * exists to show — so the screens that use it get room for both.
 */
export const heroHeightTall = 330;

/**
 * Font family names, registered in app/_layout.tsx.
 *
 * Nunito's rounded, heavy forms sit far better on parchment than a geometric sans;
 * the fallback matters because fonts load asynchronously and a screen rendered
 * before they arrive must not reflow on a different metric.
 */
export const fonts = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  black: 'Nunito_800ExtraBold',
} as const;

export const type = {
  /** Timer readout and any other number that is the whole point of its screen. */
  timer: {
    fontFamily: fonts.black,
    fontSize: 64,
    // Not `as const`: RN's TextStyle wants a mutable FontVariant[].
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  /** A large number inside a card — XP gained, a stat total, a duel score. */
  display: {
    fontFamily: fonts.black,
    fontSize: 30,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  /** The screen title, which sits on the hero image. */
  hero: { fontFamily: fonts.black, fontSize: 28 },
  title: { fontFamily: fonts.black, fontSize: 22 },
  heading: { fontFamily: fonts.bold, fontSize: 17 },
  body: { fontFamily: fonts.regular, fontSize: 15 },
  /** Buttons, tabs, and anything that labels a control. */
  label: { fontFamily: fonts.bold, fontSize: 14 },
  /** Section headers above a group. Small, heavy, wide-tracked, muted. */
  overline: { fontFamily: fonts.black, fontSize: 11, letterSpacing: 0.8 },
  caption: { fontFamily: fonts.medium, fontSize: 12 },
} as const;
