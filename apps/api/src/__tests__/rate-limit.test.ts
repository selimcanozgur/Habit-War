/**
 * Rate limiting tests.
 *
 * The limiter is lifted under NODE_ENV=test so the other suites do not throttle each
 * other, which means this file has to build its own app with limits restored — and
 * that is exactly why these tests matter. A limiter that is disabled everywhere it
 * is tested is a limiter nobody has ever seen work.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

const prisma = new PrismaClient();
const PREFIX = 'test_rl_';

let app: FastifyInstance;
let userA: string;
let userB: string;

/**
 * Builds an app with limits live.
 *
 * NODE_ENV is 'development' rather than 'test' purely to switch the limiter on;
 * nothing else in the app branches on it in a way these tests depend on. REDIS_URL
 * is omitted so counters stay in-process and one test cannot leak into the next
 * through a shared Redis key.
 */
async function appWithLimits(): Promise<FastifyInstance> {
  return buildServer(
    loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      LOG_LEVEL: 'fatal',
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv),
  );
}

async function makeUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
    },
  });
  return user.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  userA = await makeUser('a');
  userB = await makeUser('b');
  app = await appWithLimits();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function get(url: string, userId: string) {
  return app.inject({ method: 'GET', url, headers: { 'x-dev-user-id': userId } });
}

/** `GET /v1/me/export` is the tightest limit in the table: 3 per hour. */
const EXPORT_LIMIT = 3;

describe('limits are enforced', () => {
  it('serves requests up to the limit and refuses the next one', async () => {
    for (let i = 0; i < EXPORT_LIMIT; i++) {
      const response = await get('/v1/me/export', userA);
      expect(response.statusCode, `request ${i + 1} should have been allowed`).toBe(200);
    }

    const blocked = await get('/v1/me/export', userA);
    expect(blocked.statusCode).toBe(429);
  });

  it('answers 429 in the same error envelope as every other failure', async () => {
    for (let i = 0; i < EXPORT_LIMIT; i++) await get('/v1/me/export', userA);
    const blocked = await get('/v1/me/export', userA);

    const body = blocked.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toHaveProperty('retryAfterMs');
  });

  it('sends the standard rate-limit headers so a client can back off', async () => {
    const response = await get('/v1/me/export', userA);
    expect(response.headers).toHaveProperty('x-ratelimit-limit');
    expect(response.headers).toHaveProperty('x-ratelimit-remaining');
  });
});

describe('keying', () => {
  /**
   * The bug this rules out: keying on IP alone. Every request in a test — and every
   * request from one university network — shares an address, so an IP-keyed limiter
   * would let one user lock out everyone around them.
   */
  it('does not let one user consume another user\'s budget', async () => {
    for (let i = 0; i < EXPORT_LIMIT; i++) await get('/v1/me/export', userA);
    expect((await get('/v1/me/export', userA)).statusCode).toBe(429);

    const otherUser = await get('/v1/me/export', userB);
    expect(otherUser.statusCode).toBe(200);
  });

  it('counts each route against its own budget', async () => {
    for (let i = 0; i < EXPORT_LIMIT; i++) await get('/v1/me/export', userA);
    expect((await get('/v1/me/export', userA)).statusCode).toBe(429);

    // A different route has its own counter; exhausting one must not close the app.
    expect((await get('/v1/books', userA)).statusCode).toBe(200);
  });

  /**
   * The reverse direction, and the one users actually hit: ordinary browsing must not
   * spend a tight route's budget. With one shared counter, a user who opened a few
   * screens (each fans out into several GETs) found logging pages — limited to 10 a
   * minute — already "exhausted" before they had logged anything.
   */
  it('does not let ordinary traffic spend a tight route\'s budget', async () => {
    for (let i = 0; i < EXPORT_LIMIT * 4; i++) {
      expect((await get('/v1/books', userA)).statusCode).toBe(200);
    }

    expect((await get('/v1/me/export', userA)).statusCode).toBe(200);
  });
});

describe('exemptions', () => {
  /**
   * Health checks are how the platform decides whether to keep an instance in
   * rotation. Throttling them turns a traffic spike into a removed instance, which
   * sends the same spike to fewer machines.
   */
  it('never throttles health checks', async () => {
    for (let i = 0; i < 200; i++) {
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe('test-environment behaviour', () => {
  /**
   * Guards the arrangement the rest of the suite depends on: limits lifted under
   * NODE_ENV=test. If this ever stops holding, unrelated suites start failing with
   * 429s that look like application bugs.
   */
  it('lifts the ceiling under NODE_ENV=test', async () => {
    const testApp = await buildServer(
      loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: process.env['DATABASE_URL'] as string,
        LOG_LEVEL: 'fatal',
        AUTH_MODE: 'dev',
      } as NodeJS.ProcessEnv),
    );

    for (let i = 0; i < EXPORT_LIMIT + 2; i++) {
      const response = await testApp.inject({
        method: 'GET',
        url: '/v1/me/export',
        headers: { 'x-dev-user-id': userA },
      });
      expect(response.statusCode).toBe(200);
    }

    await testApp.close();
  });
});
