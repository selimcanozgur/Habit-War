/**
 * Game module request contracts — duels, badges, seasons.
 *
 * As in the friends module, another person is addressed by `username` and never by
 * id: a cuid is unguessable for a stranger, so an id-addressed duel endpoint would
 * be unusable from a real client, and email would turn the endpoint into an
 * account-enumeration oracle.
 */

import { z } from 'zod';

import { DUEL_TASK_MAX_LENGTH, DUEL_TASK_MIN_LENGTH } from '@habitwar/domain';

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
 * Every new duel is a task duel: `task` is required, the one thing both sides commit
 * to doing each day. `category` is optional context only — task duels are scored in
 * check-in days, not in a category's XP. Legacy XP duels can no longer be opened.
 *
 * `days` is bounded to the spec's 3-7 window (§5.4). Anything outside is rejected at
 * the edge rather than silently clamped — a client asking for a 30-day duel has a
 * bug, and clamping would hide it.
 */
export const createChallengeBody = z.object({
  opponentUsername: username,
  task: z.string().trim().min(DUEL_TASK_MIN_LENGTH).max(DUEL_TASK_MAX_LENGTH),
  category: category.optional(),
  days: z.number().int().min(CHALLENGE_MIN_DAYS).max(CHALLENGE_MAX_DAYS),
});

export const challengeIdParams = z.object({ id: z.string().cuid() });

/** A bestiary key: lowercase words joined by hyphens. */
export const monsterKeyParams = z.object({
  key: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/).max(40),
});

/** A day's check-in: an optional line for the opponent to read. */
export const checkInBody = z
  .object({ note: z.string().trim().max(140).optional() })
  .default({});

export const checkInParams = z.object({ id: z.string().cuid(), checkInId: z.string().cuid() });

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
