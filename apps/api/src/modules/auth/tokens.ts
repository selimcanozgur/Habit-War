/**
 * Access and refresh tokens.
 *
 * Two tokens, because they answer different questions. The access token is a short
 * JWT the API can check without touching the database — that is what keeps every
 * request cheap. The refresh token is a long opaque string with a row behind it,
 * which is what makes sign-out real: revoking a row stops the next refresh, whereas
 * a stateless token stays valid until it expires no matter what the server thinks.
 *
 * Only the refresh token's hash is stored. Whoever reads this table gets digests,
 * not working credentials — the same reason passwords are not stored either.
 *
 * Rotation on every refresh, with the used row kept rather than deleted. If a token
 * that was already rotated comes back, that is either a stolen token or a client
 * that retried; both are handled by revoking the whole family, because the two are
 * indistinguishable from here and the safe reading is theft.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * How long an access token lives.
 *
 * Short, because it cannot be revoked: fifteen minutes is the window during which a
 * stolen access token still works after the session behind it was killed. Making it
 * longer would save a handful of refresh calls and widen that window for every user.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * How long a refresh token lives.
 *
 * Sixty days. A habit tracker is opened daily, so in practice the token rotates long
 * before this matters; the length is for the user who travels for a month and should
 * not come back to a sign-in screen.
 */
export const REFRESH_TOKEN_TTL_DAYS = 60;

/** 256 bits of entropy, url-safe. Guessing is not a threat model at this size. */
const REFRESH_TOKEN_BYTES = 32;

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'habitwar';
const JWT_AUDIENCE = 'habitwar-app';

export interface AccessTokenClaims {
  /** Local User.id. */
  readonly userId: string;
  /** Session row this token was minted from, so a refresh can be traced to a device. */
  readonly sessionId: string;
}

/**
 * Mints a signed access token.
 *
 * The secret is passed in rather than read from the environment here, so tests can
 * sign with their own key and the module never reaches for global state.
 */
export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: Uint8Array,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(claims.userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secret);
}

/**
 * Verifies an access token and returns its claims.
 *
 * Throws on anything wrong — bad signature, wrong issuer, expiry — and the caller
 * turns that into a 401. Issuer and audience are checked, not just the signature:
 * without them a token signed with the same secret for another purpose would be
 * accepted here.
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  const userId = payload.sub;
  const sessionId = (payload as JWTPayload & { sid?: unknown }).sid;
  if (typeof userId !== 'string' || userId === '') {
    throw new Error('token has no subject');
  }
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error('token has no session id');
  }
  return { userId, sessionId };
}

/** A fresh refresh token. Returned once, in the response; only its hash is kept. */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * Hashes a refresh token for storage and lookup.
 *
 * Plain SHA-256 rather than Argon2, deliberately. A refresh token is 256 random
 * bits, so there is no dictionary to run against it and no work factor worth the
 * latency on every refresh; the hash exists so that a database leak yields nothing
 * usable, which SHA-256 achieves for a value of this entropy.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison for token digests.
 *
 * Lookups go through the unique index on `tokenHash`, so this is for the places that
 * compare two digests directly. Length is checked first because `timingSafeEqual`
 * throws on a mismatch rather than returning false.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** When a refresh token minted now should stop working. */
export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Email verification and password reset
// ---------------------------------------------------------------------------

/**
 * How long a verification or reset link works.
 *
 * One hour. Long enough for a mail that lands in spam and is found later, short
 * enough that a forwarded thread or a shared inbox stops being a way in.
 */
export const EMAIL_TOKEN_TTL_MINUTES = 60;

/** 192 bits — shorter than a refresh token because it goes in a URL, still unguessable. */
const EMAIL_TOKEN_BYTES = 24;

export function generateEmailToken(): string {
  return randomBytes(EMAIL_TOKEN_BYTES).toString('base64url');
}

/** Same reasoning as the refresh token: high-entropy value, so SHA-256 is enough. */
export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function emailTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + EMAIL_TOKEN_TTL_MINUTES * 60 * 1000);
}
