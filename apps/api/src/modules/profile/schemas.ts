/**
 * Profile request contracts.
 *
 * Two rules are enforced here rather than in the service, because they are shape
 * questions and a malformed value must never reach a write:
 *
 *  - `timezone` must be an IANA zone the runtime actually knows. This field owns the
 *    day boundary for streaks, daily caps and league weeks (see User.timezone), and
 *    `localDateKey()` throws a RangeError on an unknown zone — so an unvalidated
 *    write here would turn every subsequent session completion into a 500 for that
 *    user and silently break their streaks.
 *  - `bio` is capped at 160 characters to match `@db.VarChar(160)`. Letting Prisma
 *    surface the truncation as a database error would be a 500 for a user typo.
 */

import { z } from 'zod';

const CLASS_TYPES = ['SCHOLAR', 'BERSERKER', 'BARD', 'MONK', 'RANGER', 'ARTISAN'] as const;

/**
 * Validates an IANA timezone against the runtime's own tz database.
 *
 * `Intl.DateTimeFormat` throws a RangeError for an unknown zone, which is exactly the
 * check we want: it asks the same database `localDateKey()` will ask later, so a
 * value accepted here cannot fail there. A hand-maintained allowlist would drift from
 * the platform every time the tz database ships a rename.
 */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  // Reject "UTC+3"-style offsets and bare abbreviations even where a runtime tolerates
  // them: a fixed offset does not observe DST, so a user on one would drift an hour
  // out of their own day boundary twice a year.
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/, 'timezone must be an IANA zone id')
  .refine(isValidTimeZone, 'Unknown IANA timezone');

export const updateProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    /** Nullable so a user can clear their bio; `.max(160)` mirrors the column width. */
    bio: z.string().trim().max(160).nullable(),
    timezone: timezoneSchema,
    avatarUrl: z.string().url().max(500).nullable(),
  })
  .partial()
  // An empty PATCH is almost always a client bug, and answering 200 hides it.
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one field must be provided',
  });

/**
 * Username lookup. Matches the normalisation in modules/users/service.ts — a lookup
 * that accepts characters the writer can never produce is just a slower 404.
 */
export const usernameParams = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/, 'username must be lowercase alphanumeric or underscore'),
});

export const statsQuery = z.object({
  period: z.enum(['week', 'month', 'all']).default('week'),
});

export const selectClassBody = z.object({
  classType: z.enum(CLASS_TYPES),
});

export const leaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
export type StatsQuery = z.infer<typeof statsQuery>;
export type SelectClassBody = z.infer<typeof selectClassBody>;
