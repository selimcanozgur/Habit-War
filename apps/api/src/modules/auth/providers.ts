/**
 * Verifying Google and Apple identity tokens.
 *
 * The mobile app runs the sign-in flow and sends us the ID token it received. That
 * token is the only thing we trust — never the email or name the client claims
 * alongside it, because anything the client says about itself is editable by whoever
 * is running the client.
 *
 * Both providers publish their signing keys as a JWKS, so verification is: fetch the
 * key set, check the signature, then check that the token was minted for *this* app.
 * The audience check is the part that is easy to skip and expensive to skip — a
 * correctly-signed Google token issued for some other application would otherwise
 * authenticate its bearer here as whoever that token names.
 *
 * `createRemoteJWKSet` caches the keys and refreshes them when it meets an unknown
 * key id, so this does not make a network call per sign-in.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Claims this product needs out of a provider token. */
export interface ProviderClaims {
  /** The provider's stable subject id. */
  readonly providerAccountId: string;
  readonly email: string;
  /** Whether the provider says it has verified the address. */
  readonly emailVerified: boolean;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly imageUrl: string | null;
}

/** Verifies a provider's ID token. Injected at the route so tests need no network. */
export type ProviderVerifier = (idToken: string) => Promise<ProviderClaims>;

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
const appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);

/**
 * Google ID token verification.
 *
 * `audiences` is a list because the same Google project issues a different client id
 * per platform — iOS, Android and web are three ids for one app, and a token minted
 * for any of them is legitimately ours.
 *
 * Google marks `email_verified` false for some Workspace configurations, and that
 * flag is passed through rather than assumed: it decides whether this sign-in may
 * attach itself to an existing account with the same address.
 */
export function googleVerifier(audiences: readonly string[]): ProviderVerifier {
  return async (idToken) => {
    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience: [...audiences],
    });

    const email = stringClaim(payload['email']);
    if (!payload.sub || !email) {
      throw new Error('Google token is missing sub or email');
    }

    return {
      providerAccountId: payload.sub,
      email,
      emailVerified: payload['email_verified'] === true,
      firstName: stringClaim(payload['given_name']),
      lastName: stringClaim(payload['family_name']),
      imageUrl: stringClaim(payload['picture']),
    };
  };
}

/**
 * Apple ID token verification.
 *
 * Apple sends the user's name exactly once, in the authorisation response and not in
 * the token, so the name is always null here and the account is created from the
 * email. That is why `createUser` has to produce a sound username without one.
 *
 * With "Hide My Email" the address is a private relay that forwards to the user. It
 * is a real, deliverable address and Apple has verified it, so it is treated like
 * any other — and it is the reason nothing in this product may assume the domain of
 * an address means anything.
 */
export function appleVerifier(audiences: readonly string[]): ProviderVerifier {
  return async (idToken) => {
    const { payload } = await jwtVerify(idToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: [...audiences],
    });

    const email = stringClaim(payload['email']);
    if (!payload.sub || !email) {
      throw new Error('Apple token is missing sub or email');
    }

    // Apple sends this as the string "true" rather than a boolean in some versions,
    // so both are accepted; anything else counts as unverified.
    const verifiedClaim = payload['email_verified'];
    const emailVerified = verifiedClaim === true || verifiedClaim === 'true';

    return {
      providerAccountId: payload.sub,
      email,
      emailVerified,
      firstName: null,
      lastName: null,
      imageUrl: null,
    };
  };
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
