/**
 * Visual tokens.
 *
 * The palette is the one in DESIGN.md, applied with restraint: content first, colour
 * only where it means something.
 *  - The page is a neutral grouped ground (Fog) and content sits on borderless Paper
 *    White cards. Hierarchy comes from type and spacing, not from boxes and edges.
 *  - Electric Violet is the one interactive colour: buttons, links, the active tab.
 *  - Sunbeam Yellow is reward and rank — gold stars, the first-place disc — never a
 *    surface.
 *  - Carbon is ink. Dark grounds survive only where text sits over an illustration.
 *  - Status hues (XP, fire, success, danger) mark state, never decoration.
 * Text colour follows the ground, never the other way round.
 *
 * Every screen reads from these names. Changing a value here re-skins the app, which
 * is why nothing below is repeated in a StyleSheet.
 */

import { StyleSheet } from 'react-native';

export const colors = {
  /** Page ground behind the cards. Fog: neutral, so the cards and the one accent carry the screen. */
  bg: '#EFEFEF',
  /** Darkest surface: tab bar, bottom sheets, overlay panels. Carbon. */
  stone: '#312F27',
  /** The RPG panel — a season banner, a duel board. Carbon, like every dark surface: the palette has one dark. */
  panel: '#312F27',
  /** Framing on a dark panel, chips and tracks inside one. Slate Gray, which carries white text. */
  frame: '#788086',

  /** Card ground. The app's main reading surface. Paper White. */
  surface: '#FFFFFF',
  /** A recess inside a card: a progress track, an empty slot, a stat strip. Fog. */
  surfaceRaised: '#EFEFEF',
  /** Deeper recess, for a track that must read as cut into the page. Sand. */
  surfaceSunken: '#E9E4D9',

  /** Hairline separators between rows inside a card. Cards themselves have no edge. */
  border: '#E9E4D9',
  /** Ash, for the rare edge that has to read — an input, an unearned badge. */
  borderStrong: '#B1AFA7',

  /** Ink on paper and on the yellow page. Carbon — warmer than black, and it does not vibrate on yellow. */
  text: '#312F27',
  textMuted: '#5F5C52',
  /**
   * Metadata and placeholders. Darker than Ash: Ash is a border colour, and at 2.2:1
   * on white it is not readable as text.
   */
  textFaint: '#8A877D',
  /** Text on any dark ground — carbon, panel, hero overlay. */
  textOnDark: '#FFFFFF',
  textOnDarkMuted: '#B1AFA7',
  /** Text on a saturated fill. */
  textOnAccent: '#FFFFFF',

  /** Primary. Electric Violet: every "go" action, every link, every icon that is not a status. */
  accent: '#7700FF',
  /** The bottom of the violet gradient — a pressed control's slab. */
  accentDark: '#5C00FF',
  /** The top of the violet gradient. */
  accentBright: '#9400FF',
  accentSoft: '#EFE5FF',

  /** XP and anything magical: progress bars, level badges, the duel bar. The violet family, a shade off the accent. */
  xp: '#9400FF',
  xpDark: '#5C00FF',
  xpSoft: '#F1E3FF',

  /** Done, complete, ahead. Never a call to action. */
  success: '#30AF29',
  successDark: '#248420',
  successSoft: '#E1F4DF',

  /** Streaks, energy, fire. Warmth, not alarm. */
  fire: '#E37537',
  fireDark: '#BC5A24',
  fireSoft: '#FBE7DA',

  /** Rewards, rank, rarity. Sunbeam Yellow — on dark grounds and as a fill; goldDark is the one that reads as text on white. */
  gold: '#FFC500',
  goldDark: '#8F6A00',
  goldSoft: '#FFF3CC',

  danger: '#C4452F',
  dangerDark: '#9A3423',
  dangerSoft: '#F7DFDA',
} as const;

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
  lg: 16,
  pill: 999,
} as const;

/** One hairline for every separator, so rows divide the same way on every screen. */
export const hairline = StyleSheet.hairlineWidth;

/**
 * Height of the illustrated header each screen opens with.
 *
 * Tall enough to establish the world, short enough that the first card is visible
 * without scrolling on a small handset.
 */
export const heroHeight = 190;

/**
 * Font family names, registered in app/_layout.tsx.
 *
 * Nunito's rounded, heavy forms suit the playful tone better than a geometric sans;
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
