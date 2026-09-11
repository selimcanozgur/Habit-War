/**
 * Mapping Clerk identities onto local User rows.
 *
 * Clerk owns identity; this database owns progression. The only link between them is
 * `User.clerkId`. Keeping that link correct is the whole job of this module, and it
 * is the part the spec never budgeted for — it named Clerk as the auth provider but
 * gave `User` no field to correlate against.
 *
 * Two paths keep the two sides in sync, deliberately:
 *
 *  - The webhook is authoritative for updates and deletions.
 *  - Just-in-time provisioning covers the gap for creation, because a webhook can be
 *    delayed, retried or dropped, and a user who has just signed up must not get a
 *    404 on their first request.
 */

import type { PrismaClient, User } from '@prisma/client';

/** The subset of a Clerk user this service needs. Keeps the SDK out of the signature. */
export interface ClerkIdentity {
  readonly clerkId: string;
  readonly email: string;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly imageUrl: string | null;
}

/** Fetches an identity from Clerk. Injected so tests need no Clerk tenant. */
export type IdentityFetcher = (clerkId: string) => Promise<ClerkIdentity>;

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const MAX_USERNAME_ATTEMPTS = 25;

/**
 * Derives a legal username from whatever Clerk provides.
 *
 * Clerk usernames are optional and may contain characters this product does not
 * allow, so the value is always normalised rather than trusted. The fallbacks run
 * username → email local part → a slice of the Clerk id, which is guaranteed to
 * exist.
 */
export function deriveUsername(identity: ClerkIdentity): string {
  const candidates = [
    identity.username,
    identity.email.split('@')[0],
    `user_${identity.clerkId.replace(/^user_/, '').slice(0, 8)}`,
  ];

  for (const candidate of candidates) {
    const normalised = normaliseUsername(candidate);
    if (normalised) return normalised;
  }
  // Unreachable: the clerkId fallback always normalises to something.
  return `user_${Date.now().toString(36)}`.slice(0, USERNAME_MAX);
}

function normaliseUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length < USERNAME_MIN) return null;
  return cleaned.slice(0, USERNAME_MAX);
}

/** A display name from whatever parts Clerk has, falling back to the username. */
export function deriveDisplayName(identity: ClerkIdentity, username: string): string {
  const parts = [identity.firstName, identity.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : username;
}

/**
 * Finds a free username, appending a numeric suffix on collision.
 *
 * Racy by nature — two signups can pick the same name between the check and the
 * insert — so the caller must still handle a unique-constraint failure. This only
 * keeps the common case tidy.
 */
async function findFreeUsername(prisma: PrismaClient, base: string): Promise<string> {
  const taken = await prisma.user.findUnique({ where: { username: base } });
  if (!taken) return base;

  for (let suffix = 2; suffix <= MAX_USERNAME_ATTEMPTS; suffix++) {
    const stem = base.slice(0, USERNAME_MAX - String(suffix).length);
    const candidate = `${stem}${suffix}`;
    const exists = await prisma.user.findUnique({ where: { username: candidate } });
    if (!exists) return candidate;
  }

  // Fall back to something collision-proof rather than failing the signup.
  return `${base.slice(0, 10)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns the local user for a Clerk id, provisioning one if this is their first
 * authenticated request.
 *
 * @throws when the Clerk identity cannot be fetched — the caller turns that into a
 *   401 rather than silently creating a half-populated account.
 */
export async function resolveUser(
  prisma: PrismaClient,
  clerkId: string,
  fetchIdentity: IdentityFetcher,
): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

  const identity = await fetchIdentity(clerkId);
  const base = deriveUsername(identity);
  const username = await findFreeUsername(prisma, base);

  try {
    return await prisma.user.create({
      data: {
        clerkId,
        username,
        displayName: deriveDisplayName(identity, username),
        email: identity.email,
        avatarUrl: identity.imageUrl,
      },
    });
  } catch (error) {
    // Two concurrent first requests can both miss the lookup and both insert.
    // Whoever lost the race just reads the winner's row.
    const raced = await prisma.user.findUnique({ where: { clerkId } });
    if (raced) return raced;
    throw error;
  }
}

/** Applies a `user.updated` webhook. A no-op for an unknown id. */
export async function syncUser(prisma: PrismaClient, identity: ClerkIdentity): Promise<User | null> {
  const existing = await prisma.user.findUnique({ where: { clerkId: identity.clerkId } });
  if (!existing) return null;

  return prisma.user.update({
    where: { clerkId: identity.clerkId },
    data: {
      email: identity.email,
      avatarUrl: identity.imageUrl,
      // displayName and username are user-editable in this product, so Clerk does
      // not overwrite them after creation.
    },
  });
}

/**
 * Applies a `user.deleted` webhook.
 *
 * Soft delete, not a row drop. A hard delete would take the user's sessions with it,
 * and those sessions are what other users' aggregates and any dispute over an XP
 * correction were computed from. The scheduled erasure job handles the real deletion
 * once the retention window closes.
 */
export async function softDeleteUser(prisma: PrismaClient, clerkId: string): Promise<User | null> {
  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (!existing || existing.deletedAt) return existing;

  return prisma.user.update({
    where: { clerkId },
    data: { deletedAt: new Date() },
  });
}
