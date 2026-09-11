/**
 * End-to-end auth tests.
 *
 * These drive the real Fastify app and the real database; only Clerk itself is
 * stubbed, through the injection points the auth plugin exposes. That keeps the
 * parts most likely to break — header parsing, the 401 boundary, provisioning, the
 * soft-delete gate — under test without needing a Clerk tenant.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv, type Env } from '../env.js';
import { buildServer } from '../server.js';
import type { ClerkIdentity } from '../modules/users/service.js';

const prisma = new PrismaClient();
const TEST_PREFIX = 'test_auth_';
const CLERK_ID = `${TEST_PREFIX}clerk_1`;

/** Maps a stub token to a Clerk subject; anything else is rejected. */
const VALID_TOKEN = 'valid-token';

function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env['DATABASE_URL'] as string,
    LOG_LEVEL: 'fatal',
    AUTH_MODE: 'clerk',
    CLERK_SECRET_KEY: 'sk_test_stub',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

const identity: ClerkIdentity = {
  clerkId: CLERK_ID,
  email: 'auth.test@example.com',
  username: `${TEST_PREFIX}kullanici`,
  firstName: 'Deniz',
  lastName: 'Kaya',
  imageUrl: null,
};

let app: FastifyInstance;
let identityCalls = 0;

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: TEST_PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  identityCalls = 0;
  app = await buildServer(testEnv(), {
    auth: {
      verifyTokenFn: async (token) => {
        if (token !== VALID_TOKEN) throw new Error('bad token');
        return CLERK_ID;
      },
      fetchIdentityFn: async () => {
        identityCalls++;
        return identity;
      },
    },
  });
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function get(headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url: '/v1/habits', headers });
}

describe('clerk auth mode', () => {
  it('rejects a request with no Authorization header', async () => {
    const response = await get();
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a non-bearer scheme', async () => {
    const response = await get({ authorization: `Basic ${VALID_TOKEN}` });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an empty bearer value', async () => {
    const response = await get({ authorization: 'Bearer ' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const response = await get({ authorization: 'Bearer forged' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Invalid or expired token');
  });

  it('does not leak why verification failed', async () => {
    const response = await get({ authorization: 'Bearer forged' });
    expect(JSON.stringify(response.json())).not.toContain('bad token');
  });

  it('accepts a valid token and provisions the account', async () => {
    const response = await get({ authorization: `Bearer ${VALID_TOKEN}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().habits).toEqual([]);

    const user = await prisma.user.findUnique({ where: { clerkId: CLERK_ID } });
    expect(user?.email).toBe('auth.test@example.com');
    expect(identityCalls).toBe(1);
  });

  it('does not re-query Clerk once the account exists', async () => {
    await get({ authorization: `Bearer ${VALID_TOKEN}` });
    await get({ authorization: `Bearer ${VALID_TOKEN}` });
    expect(identityCalls).toBe(1);
  });

  it('returns 401 when the Clerk lookup fails, and creates nothing', async () => {
    const failing = await buildServer(testEnv(), {
      auth: {
        verifyTokenFn: async () => CLERK_ID,
        fetchIdentityFn: async () => {
          throw new Error('clerk down');
        },
      },
    });

    const response = await failing.inject({
      method: 'GET',
      url: '/v1/habits',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.user.findUnique({ where: { clerkId: CLERK_ID } })).toBeNull();
    await failing.close();
  });

  it('refuses a soft-deleted account even with a valid token', async () => {
    await get({ authorization: `Bearer ${VALID_TOKEN}` });
    await prisma.user.update({ where: { clerkId: CLERK_ID }, data: { deletedAt: new Date() } });

    const response = await get({ authorization: `Bearer ${VALID_TOKEN}` });
    expect(response.statusCode).toBe(403);
  });

  it('scopes writes to the authenticated user', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/habits',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { name: 'Kitap okuma', category: 'STUDY', targetMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { clerkId: CLERK_ID } });
    expect(created.json().habit.userId).toBe(user.id);
  });
});

describe('environment guards', () => {
  it('requires a Clerk secret key in clerk mode', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: process.env['DATABASE_URL'] as string,
        AUTH_MODE: 'clerk',
      } as NodeJS.ProcessEnv),
    ).toThrow(/CLERK_SECRET_KEY/);
  });

  /** The whole point of the mode flag: a dev shortcut must not survive a deploy. */
  it('refuses dev header auth in production', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: process.env['DATABASE_URL'] as string,
        AUTH_MODE: 'dev',
      } as NodeJS.ProcessEnv),
    ).toThrow(/production/);
  });

  it('allows dev header auth outside production', () => {
    const env = loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv);
    expect(env.AUTH_MODE).toBe('dev');
  });

  it('defaults to clerk mode rather than the permissive one', () => {
    const env = loadEnv({
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      CLERK_SECRET_KEY: 'sk_test_stub',
    } as NodeJS.ProcessEnv);
    expect(env.AUTH_MODE).toBe('clerk');
  });
});

describe('dev auth mode', () => {
  it('accepts a known user id and rejects an unknown one', async () => {
    const seeded = await prisma.user.create({
      data: {
        clerkId: `${TEST_PREFIX}dev`,
        username: `${TEST_PREFIX}dev_user`,
        displayName: 'Dev',
        email: 'dev.auth@example.com',
      },
    });

    const devApp = await buildServer(testEnv({ AUTH_MODE: 'dev' }));

    const ok = await devApp.inject({
      method: 'GET',
      url: '/v1/habits',
      headers: { 'x-dev-user-id': seeded.id },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await devApp.inject({
      method: 'GET',
      url: '/v1/habits',
      headers: { 'x-dev-user-id': 'cmzzzzzzzzzzzzzzzzzzzzzzzz' },
    });
    expect(bad.statusCode).toBe(401);

    await devApp.close();
  });
});
