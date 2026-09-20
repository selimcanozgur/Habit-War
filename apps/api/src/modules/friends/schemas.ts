/**
 * Friendship, follow and user-search contracts.
 *
 * Every lookup of another person is by `username`, never by id: ids are cuids the
 * client has no way to know for a stranger, and never by email, because an endpoint
 * that confirms "this email has an account" is an account-enumeration oracle whether
 * or not it returns a profile.
 */

import { z } from 'zod';

/**
 * Usernames are normalised to `[a-z0-9_]`, 3-20 characters, by
 * `modules/users/service.ts`. Mirroring that shape here means a malformed handle is
 * rejected before it reaches the database rather than coming back as an empty result
 * the client has to interpret.
 */
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/, 'username may contain only letters, digits and underscores');

export const friendTargetBody = z.object({ username });

export const friendshipIdParams = z.object({ id: z.string().cuid() });

export const followUsernameParams = z.object({ username });

/**
 * Search is deliberately blunt: a 3-character floor and a hard result cap.
 *
 * A 1-character prefix search over a user table is a directory dump, and an
 * unbounded limit lets a caller page through the whole user base. Neither is a
 * feature anyone asked for; both are how a social graph gets scraped.
 */
export const userSearchQuery = z.object({
  q: z.string().trim().min(3).max(40),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

export type FriendTargetBody = z.infer<typeof friendTargetBody>;
export type UserSearchQuery = z.infer<typeof userSearchQuery>;
