/**
 * Timezone helpers the jobs need and `@habitwar/domain` does not have.
 *
 * `localDateKey` already lives in the domain package, because "which day was that
 * for this user" is a game rule that the API, the jobs and eventually the client all
 * have to answer identically. "Which HOUR is it for this user" is not a game rule —
 * nothing about XP, streaks or caps depends on it. It is purely a scheduling concern,
 * so it lives with the scheduler rather than widening the domain package's surface.
 *
 * Both helpers go through `Intl`, which is built into the runtime and carries the
 * platform's tz database, so DST transitions and half-hour offsets (Asia/Kolkata at
 * +05:30, Pacific/Chatham at +12:45) are handled by the platform rather than by
 * offset arithmetic somebody would get wrong.
 */

/**
 * The hour (0-23) on the user's own wall clock at `instant`.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`: the latter renders midnight as
 * "24" under some ICU versions, which would make an hour-equality check silently
 * miss one hour a day.
 *
 * @throws RangeError if the timezone is not recognised. Deliberate — a silent
 *   fallback to UTC would send a Turkish user's evening reminder at 23:00 local and
 *   nobody would ever find out why.
 */
export function localHour(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

  const hour = Number.parseInt(formatted, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`localHour: unexpected hour "${formatted}" for timezone "${timeZone}"`);
  }
  return hour;
}

/**
 * Whether the runtime recognises this IANA timezone.
 *
 * `User.timezone` is a plain string column with no database-level validation, so a
 * bad value can be sat in a row right now. A job that sweeps every user must be able
 * to skip that one row and count it, rather than throwing and taking the other
 * hundred thousand users' reminders down with it.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
