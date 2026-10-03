/**
 * End-to-end auth tests.
 *
 * These drive the real Fastify app, the real database and the real token code —
 * nothing is stubbed but outbound mail, which is captured so a test can read the
 * token it would have sent. Auth is the one area where "we'll check it in staging"
 * means shipping it untested, and most of what can go wrong here is invisible to a
 * unit test: the 401 boundary, whether sign-out actually ends a session, whether a
 * replayed refresh token is caught.
 *
 * Everything is namespaced by email and username prefix so a failed run cannot
 * poison the seeded developer data.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv, type Env } from '../env.js';
import { buildServer } from '../server.js';

const prisma = new PrismaClient();
const TEST_PREFIX = 'test_auth_';

const EMAIL = `${TEST_PREFIX}deniz@example.com`;
const PASSWORD = 'dogru-sifre-123';

/** 32 characters, which is what the env schema requires of a real signing key. */
const JWT_SECRET = 'test-secret-key-for-auth-tests!!';

function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env['DATABASE_URL'] as string,
    LOG_LEVEL: 'fatal',
    AUTH_MODE: 'token',
    AUTH_JWT_SECRET: JWT_SECRET,
    ...overrides,
  } as NodeJS.ProcessEnv);
}

let app: FastifyInstance;

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  app = await buildServer(testEnv());
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** Registers an account and returns the token pair. */
async function signUp(
  overrides: { email?: string; password?: string } = {},
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/sign-up',
    payload: {
      email: overrides.email ?? EMAIL,
      password: overrides.password ?? PASSWORD,
    },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
  };
}

describe('sign-up', () => {
  it('creates an account and returns a usable token', async () => {
    const { accessToken } = await signUp();

    const me = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
  });

  /** The hash must never leave the server, and `present` is the only thing stopping it. */
  it('never returns the password hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(JSON.stringify(response.json())).not.toContain('argon2');
    expect(response.json().user.passwordHash).toBeUndefined();
  });

  it('stores the password hashed, never in the clear', async () => {
    const { userId } = await signUp();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe(PASSWORD);
    expect(user?.passwordHash).toContain('argon2');
  });

  it('refuses a duplicate email', async () => {
    await signUp();
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(second.statusCode).toBe(409);
  });

  /** Case is not an identity: two casings of one address must not be two accounts. */
  it('treats a differently-cased email as the same address', async () => {
    await signUp();
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: EMAIL.toUpperCase(), password: PASSWORD },
    });

    expect(second.statusCode).toBe(409);
  });

  it('refuses a password below the length floor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: EMAIL, password: 'kisa' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('refuses a password from the common list', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: EMAIL, password: 'password123' },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('sign-in', () => {
  it('accepts the right password', async () => {
    await signUp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeTruthy();
  });

  it('rejects the wrong password', async () => {
    await signUp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: EMAIL, password: 'yanlis-sifre-123' },
    });

    expect(response.statusCode).toBe(401);
  });

  /**
   * The two failures must be indistinguishable. A different status or message for
   * an unknown address turns this route into a free user enumerator.
   */
  it('answers an unknown email exactly as a wrong password', async () => {
    await signUp();

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: EMAIL, password: 'yanlis-sifre-123' },
    });
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: `${TEST_PREFIX}yok@example.com`, password: PASSWORD },
    });

    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
  });
});

describe('access tokens', () => {
  it('refuses a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/users/me' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a token signed with the wrong key', async () => {
    const { accessToken } = await signUp();
    // Corrupting the signature leaves the payload intact, which is exactly the
    // forgery a signature exists to stop.
    const forged = `${accessToken.slice(0, -4)}AAAA`;

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a malformed authorization header', async () => {
    const { accessToken } = await signUp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: accessToken },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('refresh', () => {
  it('exchanges a refresh token for a new pair', async () => {
    const { refreshToken } = await signUp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().refreshToken).not.toBe(refreshToken);
  });

  /**
   * Rotation is only a defence if the old token stops working. If both the old and
   * the new one are live, a stolen token keeps working forever.
   */
  it('invalidates the old token after rotation', async () => {
    const { refreshToken } = await signUp();
    await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  /**
   * A replayed token means the family is compromised, so every session dies — not
   * just the one that was replayed.
   */
  it('revokes the whole family when a used token comes back', async () => {
    const { refreshToken, userId } = await signUp();
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    const fresh = rotated.json().refreshToken;

    await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

    const afterBreach = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: fresh },
    });
    expect(afterBreach.statusCode).toBe(401);

    const live = await prisma.authSession.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('sign-out', () => {
  /**
   * The point of storing sessions rather than using stateless refresh tokens: this
   * test would pass trivially for the access token and fail for the refresh token
   * if revocation were not real.
   */
  it('stops the refresh token working', async () => {
    const { refreshToken } = await signUp();

    const out = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      payload: { refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const after = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(after.statusCode).toBe(401);
  });

  /** Also ends the access token, which is what "sign out this device" has to mean. */
  it('stops the access token working', async () => {
    const { accessToken, refreshToken } = await signUp();
    await app.inject({ method: 'POST', url: '/v1/auth/sign-out', payload: { refreshToken } });

    const me = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('succeeds for an unknown token rather than reporting it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      payload: { refreshToken: 'never-existed' },
    });
    expect(response.statusCode).toBe(204);
  });

  it('ends every session on sign-out-all', async () => {
    const { accessToken, userId } = await signUp();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: EMAIL, password: PASSWORD },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out-all',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(204);

    const live = await prisma.authSession.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);
  });
});

describe('password reset', () => {
  /** Says nothing about whether the address exists — the mail is the only channel. */
  it('answers the same for a known and an unknown address', async () => {
    await signUp();

    const known = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: EMAIL },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: `${TEST_PREFIX}yok@example.com` },
    });

    expect(known.statusCode).toBe(204);
    expect(unknown.statusCode).toBe(unknown.statusCode);
    expect(unknown.statusCode).toBe(204);
  });

  it('rejects an unknown reset token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      payload: { token: 'not-a-real-token', password: 'yeni-sifre-123' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('suspension', () => {
  it('refuses a suspended account', async () => {
    const { accessToken, userId } = await signUp();
    await prisma.user.update({
      where: { id: userId },
      data: {
        suspendedUntil: new Date(Date.now() + 86_400_000),
        suspensionReason: 'test',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/habits',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * Suspension removes the ability to participate, not the right to know why or to
   * leave. Blocking the profile read would leave the user staring at an error with
   * no explanation.
   */
  it('still allows the exempt routes', async () => {
    const { accessToken, userId } = await signUp();
    await prisma.user.update({
      where: { id: userId },
      data: { suspendedUntil: new Date(Date.now() + 86_400_000), suspensionReason: 'test' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('lets an expired suspension through', async () => {
    const { accessToken, userId } = await signUp();
    await prisma.user.update({
      where: { id: userId },
      data: { suspendedUntil: new Date(Date.now() - 1000), suspensionReason: 'test' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/habits',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('deleted accounts', () => {
  it('refuses a token belonging to a deleted account', async () => {
    const { accessToken, userId } = await signUp();
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(403);
  });
});
