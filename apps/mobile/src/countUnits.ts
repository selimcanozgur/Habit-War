/**
 * What a count habit can count, and how it is counted.
 *
 * Each unit offers a few sensible daily targets and the size of one quick tap: a
 * glass of water is one, push-ups come in fives or tens. The tap size is the whole
 * reason count habits exist — two seconds, one blow — so it is chosen per unit rather
 * than left as a generic "+1" the user would have to tap fifty times.
 */

export interface CountUnit {
  readonly unit: string;
  readonly targets: readonly number[];
}

export const COUNT_UNITS: readonly CountUnit[] = [
  { unit: 'tekrar', targets: [20, 50, 100] },
  { unit: 'bardak', targets: [6, 8, 10] },
  { unit: 'sayfa', targets: [10, 20, 50] },
  { unit: 'km', targets: [2, 5, 10] },
];

/** The size of one quick tap for a habit counting `unit` toward `target`. */
export function stepFor(unit: string | null | undefined, target: number): number {
  switch (unit) {
    case 'tekrar':
      return target >= 50 ? 10 : 5;
    case 'sayfa':
      return 5;
    case 'bardak':
    case 'km':
      return 1;
    default:
      return Math.max(1, Math.round(target / 10));
  }
}
