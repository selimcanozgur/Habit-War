/**
 * Route registration smoke test.
 *
 * Ten modules register routes independently. A duplicate path, a missing prefix or a
 * plugin that throws at registration would otherwise only surface at runtime, and
 * Fastify's duplicate-route error is thrown at boot — exactly where a test can catch it.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      LOG_LEVEL: 'fatal',
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv),
  );
});

afterAll(async () => {
  await app.close();
});

/** Paths every client depends on. A typo in a prefix silently breaks the app. */
const EXPECTED = [
  'GET /health/live',
  'GET /health/ready',
  'GET /v1/habits',
  'POST /v1/habits/:id/log',
  'POST /v1/sessions/start',
  'POST /v1/sessions/:id/pause',
  'POST /v1/sessions/:id/resume',
  'GET /v1/sessions/active',
  'GET /v1/users/me',
  'POST /v1/users/me/onboarding',
  'GET /v1/users/search',
  'GET /v1/leaderboard/friends',
  'GET /v1/friends',
  'POST /v1/friends/request',
  'GET /v1/feed',
  'POST /v1/posts',
  'GET /v1/challenges',
  'POST /v1/challenges/:id/check-in',
  'POST /v1/challenges/:id/check-ins/:checkInId/dispute',
  'GET /v1/achievements',
  'GET /v1/story',
  'GET /v1/seasons/current',
  'GET /v1/notifications',
  'POST /v1/push-tokens',
  'POST /v1/blocks',
  'POST /v1/reports',
  'GET /v1/me/export',
  'DELETE /v1/me',
];

describe('route registration', () => {
  it('boots with every module registered', () => {
    expect(app).toBeDefined();
  });

  it('exposes every expected route', () => {
    const tree = app.printRoutes({ commonPrefix: false });
    for (const route of EXPECTED) {
      const [method, path] = route.split(' ');
      expect(
        app.hasRoute({ method: method as 'GET', url: path as string }),
        `${route} is not registered:\n${tree}`,
      ).toBe(true);
    }
  });

  it('requires authentication on every /v1 route', async () => {
    for (const route of EXPECTED.filter((r) => r.includes('/v1/'))) {
      const [method, path] = route.split(' ');
      const response = await app.inject({ method: method as 'GET', url: path as string });
      expect(response.statusCode, `${route} answered ${response.statusCode} unauthenticated`).toBe(
        401,
      );
    }
  });

  it('leaves health checks open', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
  });
});
