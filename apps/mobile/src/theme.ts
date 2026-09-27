/**
 * Visual tokens.
 *
 * The language is the one Duolingo made familiar: a light ground, few but very
 * saturated colours, chunky rounded shapes, bold type, and controls with a visible
 * bottom edge that compresses when pressed. It suits this product because the app
 * asks people to show up daily — and a daily habit app that feels heavy is one you
 * stop opening.
 *
 * The palette is NOT Duolingo's. Green is their brand and carries their meaning, so
 * the primary here is violet; green is kept for one job only, "this is done".
 *
 * Every screen reads from these names. Changing a value here re-skins the app, which
 * is why nothing below is repeated in a StyleSheet.
 */

import type { Stat } from '@habitwar/domain';

export const colors = {
  /** Page ground. White, not off-white: the cards are what carry the tint. */
  bg: '#FFFFFF',
  /** Card ground. Distinguished from `bg` by its border, not by its fill. */
  surface: '#FFFFFF',
  /** Tinted fill for chips and secondary rows. */
  surfaceRaised: '#F7F8FA',
  /** Recessed fill — progress tracks, empty slots. Must read as "below" the page. */
  surfaceSunken: '#E9EBF0',

  border: '#E5E7EB',
  /** For a control that needs to read as pressable without colour. */
  borderStrong: '#D3D7DE',

  /**
   * Near-black rather than black. Pure black on white is harsher than any of this
   * app's content warrants, and it makes the saturated accents look muddy beside it.
   */
  text: '#3C3C3C',
  textMuted: '#6F7480',
  textFaint: '#A8ADB8',
  /** For text on a saturated fill. */
  textOnAccent: '#FFFFFF',

  /** Primary. Every "go" action and the XP bar. */
  accent: '#7C4DFF',
  /** The bottom edge of a primary control, and its pressed state. */
  accentDark: '#5A2FD6',
  accentBright: '#9B7BFF',
  /** Tinted background for an accent-coloured chip or banner. */
  accentSoft: '#F1ECFF',

  /** Done, complete, ahead. Never used for a call to action. */
  success: '#58CC02',
  successDark: '#48A400',
  successSoft: '#EAF8DD',

  /** Streaks and fire. Warmth, not alarm. */
  warning: '#FF9600',
  warningDark: '#D67C00',
  warningSoft: '#FFF3E0',

  danger: '#FF4B4B',
  dangerDark: '#D63C3C',
  dangerSoft: '#FFECEC',

  /** Rank and class flourishes. */
  info: '#1CB0F6',
  infoSoft: '#E3F5FE',
} as const;

/**
 * Stat colours, saturated for a light ground.
 *
 * Fixed per stat so a stat keeps one identity everywhere it appears — the bar on the
 * profile, the dot on a habit row, the chip in a session reward.
 */
export const statColors: Readonly<Record<Stat, string>> = {
  STR: '#FF4B4B',
  END: '#FF9600',
  INT: '#1CB0F6',
  WIS: '#58CC02',
  CHA: '#FF5FA2',
  DEX: '#A560FF',
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

/**
 * Corner radii, deliberately large.
 *
 * Roundness is most of what makes this language read as friendly rather than
 * corporate; a 4px radius on these same colours looks like a dashboard.
 */
export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

/**
 * The depth of a control's bottom edge.
 *
 * The signature of this style: a solid control sits on a darker slab of itself and
 * compresses into it on press. It reads as physical in a way a shadow does not, and
 * unlike a shadow it survives a screenshot and a light-mode screen.
 */
export const depth = {
  button: 4,
  card: 2,
} as const;

/**
 * Font family names, registered in app/_layout.tsx.
 *
 * Nunito is the closest freely-licensed face to the rounded, heavy sans this style
 * depends on. The fallback matters: fonts load asynchronously, and a screen that
 * renders before they arrive must not collapse to a different metric.
 */
export const fonts = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  black: 'Nunito_800ExtraBold',
} as const;

/**
 * Type scale.
 *
 * Heavier and larger than a typical app: in this language weight carries hierarchy,
 * so headings are extra-bold rather than merely larger, and body text is one step up
 * from the usual 14 because the screens are short on text and long on numbers.
 */
export const type = {
  /** Timer readout and any other number that is the whole point of its screen. */
  timer: {
    fontFamily: fonts.black,
    fontSize: 64,
    // Not `as const`: RN's TextStyle wants a mutable FontVariant[].
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  /** A large number inside a card — XP gained, a stat total. */
  display: {
    fontFamily: fonts.black,
    fontSize: 34,
    fontVariant: ['tabular-nums'] as 'tabular-nums'[],
  },
  title: { fontFamily: fonts.black, fontSize: 26 },
  heading: { fontFamily: fonts.bold, fontSize: 18 },
  body: { fontFamily: fonts.regular, fontSize: 16 },
  /** Buttons, tabs, and anything that labels a control. Bold by default. */
  label: { fontFamily: fonts.bold, fontSize: 14 },
  /** Section headers above a group. Small, bold, wide-tracked, muted. */
  overline: { fontFamily: fonts.black, fontSize: 12, letterSpacing: 0.8 },
  caption: { fontFamily: fonts.medium, fontSize: 13 },
} as const;
