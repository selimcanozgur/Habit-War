/**
 * Password hashing and strength rules.
 *
 * Argon2id, which is what the OWASP password storage guidance names first and what
 * the 2015 Password Hashing Competition selected. The parameters below are OWASP's
 * baseline: 19 MiB of memory, two passes, one lane. The memory cost is the point —
 * it is what makes a GPU farm expensive rather than merely slow, and it is the knob
 * that bcrypt does not have.
 *
 * The verify path deliberately spends time even when there is no user. A sign-in
 * that returns instantly for an unknown address and slowly for a known one leaks
 * which addresses have accounts, one request at a time.
 */

import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * OWASP's recommended Argon2id baseline (as of the 2024 cheat sheet).
 *
 * Raising these later is safe: `verify` reads the parameters out of the stored
 * digest, so old hashes keep working and only new ones get the stronger settings.
 */
const ARGON_OPTIONS: Options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Minimum length.
 *
 * Eight, following NIST SP 800-63B, which also advises against composition rules
 * ("one uppercase, one symbol") — they push people towards `Password1!` and a
 * predictable mutation of a word they already reused somewhere else. Length and a
 * breach check do more than character classes ever did.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Maximum length.
 *
 * Argon2 has no low cap of its own, but an unbounded field lets someone post a
 * megabyte and make the server spend real CPU hashing it. 128 is far past any
 * genuine passphrase.
 */
export const PASSWORD_MAX_LENGTH = 128;

/** Rejected outright regardless of length — these are the top of every wordlist. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein1',
  'sifre123',
  'parola123',
  'adminadmin',
]);

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON';

/**
 * Checks a candidate password, returning the first problem or null.
 *
 * Returns a code rather than a message so the HTTP layer owns the Turkish wording
 * and this module stays free of presentation.
 */
export function checkPasswordStrength(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (password.length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'TOO_COMMON';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

/**
 * Verifies a password against a stored digest.
 *
 * A malformed or truncated digest resolves to false rather than throwing: a corrupt
 * row should refuse that one sign-in, not return a 500 that tells the caller the
 * account exists and is broken.
 */
export async function verifyPassword(digest: string, password: string): Promise<boolean> {
  try {
    return await verify(digest, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A digest of a value nobody knows, hashed once at startup.
 *
 * Used to burn the same CPU time when the email has no account, so the response
 * time of a sign-in does not reveal whether the address is registered.
 */
let decoyDigest: Promise<string> | null = null;

/** Spends a verification's worth of time without authenticating anything. */
export async function burnVerificationTime(password: string): Promise<void> {
  decoyDigest ??= hashPassword(`decoy:${Math.random()}:${Date.now()}`);
  await verifyPassword(await decoyDigest, password);
}
