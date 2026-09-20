/**
 * Game module request contracts — duels, badges, seasons.
 *
 * As in the friends module, another person is addressed by `username` and never by
 * id: a cuid is unguessable for a stranger, so an id-addressed duel endpoint would
 * be unusable from a real client, and email would turn the endpoint into an
 * account-enumeration oracle.
 */

import { z } from 'zod';

import { CHALLENGE_MAX_DAYS, CHALLENGE_MIN_DAYS } from './challenges.js';

/**
 * Mirrors the normalisation applied by `modules/users/service.ts` so a malformed
 * handle is rejected here rather than coming back as an empty lookup the client has
 * to interpret.
 */
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/, 'username may contain only letters, digits and underscores');

const category = z.enum([
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'CREATIVE',
  'SOCIAL',
  'HEALTH',
  'SKILL',
]);

/**
 * Duel creation.
 *
 * `category` is required by the task brief even though `Challenge.category` is
 * nullable in the schema (null would mean a total-XP duel). Leaving the "any
 * category" variant out of the public contract keeps the scoring path single-shaped
 * for now; it can be relaxed later without a migration.
 *
 * `days` is bounded to the spec's 3-7 window (§5.4). Anything outside is rejected at
 * the edge rather than silently clamped — a client asking for a 30-day duel has a
 * bug, and clamping would hide it.
 */
export const createChallengeBody = z.object({
  opponentUsername: username,
  category,
  days: z.number().int().min(CHALLENGE_MIN_DAYS).max(CHALLENGE_MAX_DAYS),
});

export const challengeIdParams = z.object({ id: z.string().cuid() });

/**
 * Duel list filter. `status=active` is the duel screen's default; `all` backs the
 * history tab. Kept as a coarse enum rather than exposing ChallengeStatus directly,
 * because "active" to a user means PENDING + ACTIVE, not the single enum member.
 */
export const listChallengesQuery = z.object({
  scope: z.enum(['active', 'past', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export type CreateChallengeBody = z.infer<typeof createChallengeBody>;
export type ListChallengesQuery = z.infer<typeof listChallengesQuery>;
