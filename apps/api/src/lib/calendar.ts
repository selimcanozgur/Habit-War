/**
 * Calendar arithmetic in a user's own timezone.
 *
 * Shared by everything that buckets time by the user's local day or week — the
 * profile's analytics and the weekly boss — so that "this week" means one thing.
 */

import { localDateKey } from '@habitwar/domain';

/** The zone's UTC offset in milliseconds at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  // Rendering the instant as a local wall clock and re-parsing it as if it were UTC
  // yields the offset. Intl owns the tz database, so DST needs no special handling.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  // Some ICU versions render midnight as hour "24"; normalise it.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const asUtc = Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}Z`,
  );
  return asUtc - instant.getTime();
}

/**
 * The instant a local calendar day begins, as a UTC timestamp.
 *
 * Two passes, not one: the offset that applies is the zone's offset AT the resulting
 * instant, and a single-pass guess lands on the wrong side of a DST transition twice a
 * year. The second pass re-reads the offset at the candidate instant and corrects it.
 */
export function startOfLocalDay(dateKey: string, timeZone: string): Date {
  const guess = new Date(`${dateKey}T00:00:00Z`);
  const firstPass = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  return new Date(guess.getTime() - zoneOffsetMs(firstPass, timeZone));
}

/** Shifts a local date key by whole days. */
export function addDays(dateKey: string, days: number): string {
  const shifted = new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The Monday-based week window containing `now` in the user's timezone.
 *
 * Monday rather than Sunday because the schema calls this a "league week" and the
 * product is Turkish-first, where the week starts on Monday.
 */
export function weekWindow(
  now: Date,
  timeZone: string,
): { weekStart: string; weekEnd: string; startInstant: Date } {
  const today = localDateKey(now, timeZone);
  // getUTCDay on a date key parsed as UTC gives the weekday with no zone shift.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const weekStart = addDays(today, -sinceMonday);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    startInstant: startOfLocalDay(weekStart, timeZone),
  };
}
