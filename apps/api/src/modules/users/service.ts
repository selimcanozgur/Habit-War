/**
 * Turning a new identity into a local User row.
 *
 * This product owns identity outright: a password account is created here, and a
 * Google or Apple account is created from the claims that provider asserted. What
 * stays constant either way is the shape of the row — a legal username, a display
 * name, a verified email — so both paths come through here rather than each
 * inventing their own idea of what a new user looks like.
 */

import type { PrismaClient, User } from '@prisma/client';

/**
 * What is known about a person at the moment their account is created.
 *
 * Every field but `email` is a hint. A password signup has little more than the
 * address; Google supplies a name and a picture; Apple supplies a name only on the
 * very first authorisation and never again. The derivations below are written to
 * produce a sound account from any of those.
 */
export interface NewIdentity {
  readonly email: string;
  readonly username?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly imageUrl?: string | null;
}

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const MAX_USERNAME_ATTEMPTS = 25;

/**
 * Derives a legal username from whatever the signup supplied.
 *
 * Nothing here is trusted as given: a provider's username may contain characters
 * this product does not allow, and an email local part may be too short. The
 * fallbacks run username → email local part → a random suffix, so the function
 * always returns something legal even for an address like `x@example.com`.
 */
export function deriveUsername(identity: NewIdentity): string {
  const candidates = [
    identity.username,
    identity.email.split('@')[0],
    `user_${Math.random().toString(36).slice(2, 10)}`,
  ];

  for (const candidate of candidates) {
    const normalised = normaliseUsername(candidate);
    if (normalised) return normalised;
  }
  // Unreachable in practice: the random fallback always normalises to something.
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

/** A display name from whatever name parts arrived, falling back to the username. */
export function deriveDisplayName(identity: NewIdentity, username: string): string {
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
 * Creates a user row from a fresh identity.
 *
 * `emailVerified` is the caller's call, not a guess: a password signup starts
 * unverified and must prove the address, while Google and Apple have already done
 * that work and a second verification mail would be noise.
 *
 * The username search is racy by nature — two signups can pick the same name between
 * the check and the insert — so the unique constraint is the real guarantee and the
 * caller handles the conflict.
 */
export async function createUser(
  prisma: PrismaClient,
  identity: NewIdentity,
  options: { readonly passwordHash?: string | null; readonly emailVerified: boolean },
): Promise<User> {
  const base = deriveUsername(identity);
  const username = await findFreeUsername(prisma, base);

  return prisma.user.create({
    data: {
      username,
      displayName: deriveDisplayName(identity, username),
      email: identity.email.toLowerCase(),
      avatarUrl: identity.imageUrl ?? null,
      passwordHash: options.passwordHash ?? null,
      emailVerifiedAt: options.emailVerified ? new Date() : null,
    },
  });
}

/**
 * Finds a live account by email.
 *
 * Addresses are stored and compared lowercased. Without that, `Ali@x.com` and
 * `ali@x.com` would be two accounts, and whichever one the user did not create is
 * the one they would be unable to sign in to.
 */
export function findUserByEmail(prisma: PrismaClient, email: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
  });
}

/**
 * Marks an account deleted without dropping the row.
 *
 * A hard delete would take the user's sessions with it, and those sessions are what
 * other users' aggregates and any dispute over an XP correction were computed from.
 * The scheduled erasure job performs the real deletion once the retention window
 * closes.
 *
 * Every auth session is revoked in the same breath: an account marked deleted whose
 * tokens still work is not deleted in any sense the user would recognise.
 */
export async function softDeleteUser(prisma: PrismaClient, userId: string): Promise<User | null> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing || existing.deletedAt) return existing;

  const now = new Date();
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deletedAt: now } }),
    prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
  return user;
}
