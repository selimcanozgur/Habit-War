/**
 * Rate limiting.
 *
 * The API had none, which mattered most on three kinds of route:
 *
 *  - XP creation. Session start/complete is where value is minted; the idempotency
 *    key stops an accidental double-award, not a determined one.
 *  - Enumeration. User search and friend requests let a caller walk the user table
 *    one guess at a time.
 *  - Expensive reads. `GET /me/export` runs seven full-history queries per call — a
 *    handful of concurrent requests is a self-inflicted outage.
 *
 * Keyed on the caller's credential where there is one, falling back to IP. IP alone
 * would bucket everyone behind one NAT — a university network, which is this
 * product's target audience — into a single shared limit.
 */

import { createHash } from 'node:crypto';

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';

/**
 * Global ceiling.
 *
 * A screen in this app fans out into several calls (profile, feed, active session,
 * notifications), and pull-to-refresh fires them together. 120/min leaves room for
 * roughly twenty such bursts a minute — far past ordinary use, far below what it
 * takes to hurt the database.
 */
const GLOBAL_MAX = 120;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const GLOBAL_WINDOW = MINUTE;

/**
 * Per-route overrides, tightest first.
 *
 * Every number here is a budget for a *human*, with a wide margin. The comment on
 * each says what behaviour it is sized for, because a limit whose rationale is not
 * written down gets raised the first time someone hits it.
 */
export const ROUTE_LIMITS: Readonly<Record<string, { max: number; timeWindow: number }>> = {
  // The most expensive read in the API. Nobody exports their data twice a minute;
  // a human does it once, reads the file, and maybe retries after a failure.
  'GET:/v1/me/export': { max: 3, timeWindow: HOUR },

  // Account deletion. Idempotent, so a retry is harmless, but there is no legitimate
  // reason to call it repeatedly.
  'DELETE:/v1/me': { max: 5, timeWindow: HOUR },

  // XP creation. A session lasts minutes at minimum, so even an eager user with
  // several habits cannot legitimately start more than a few in a minute.
  'POST:/v1/sessions/start': { max: 10, timeWindow: MINUTE },
  'POST:/v1/sessions/:id/complete': { max: 20, timeWindow: MINUTE },

  // Enumeration surfaces. Search is debounced client-side to roughly one call per
  // pause in typing; 30/min is generous for that and useless for walking the table.
  'GET:/v1/users/search': { max: 30, timeWindow: MINUTE },
  'POST:/v1/friends/request': { max: 20, timeWindow: HOUR },

  // Content creation. Spam control, not throughput control.
  'POST:/v1/posts': { max: 15, timeWindow: HOUR },
  'POST:/v1/posts/:id/replies': { max: 30, timeWindow: HOUR },

  // Report spam is itself a form of harassment: burying a moderator in reports about
  // one person is a way to attack them. Still high enough to report a genuinely bad
  // afternoon in the feed.
  'POST:/v1/reports': { max: 20, timeWindow: HOUR },

  'POST:/v1/blocks': { max: 30, timeWindow: HOUR },
};

/**
 * The key a request is counted against.
 *
 * Derived from the CREDENTIAL, not from `request.userId`. The limiter runs on
 * `onRequest`, while `requireUser` runs on `preHandler` — so `userId` is still empty
 * here on every request, and reading it would silently make this an IP-only limiter.
 * That is the failure mode worth avoiding: everyone behind one university NAT would
 * share a single budget, and one user could lock out the room.
 *
 * Bearer tokens are hashed before use. A rate-limit key is stored in Redis and can
 * appear in logs; a session token must not be in either.
 */
function credentialKey(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) {
      return `t:${createHash('sha256').update(token).digest('base64url').slice(0, 32)}`;
    }
  }

  const devUser = request.headers['x-dev-user-id'];
  const devUserId = Array.isArray(devUser) ? devUser[0] : devUser;
  if (devUserId) return `u:${devUserId}`;

  return `ip:${request.ip}`;
}

/** Route key used to look up an override. */
function routeKey(request: FastifyRequest): string | null {
  const url = request.routeOptions?.url;
  return url ? `${request.method}:${url}` : null;
}

/**
 * The counter a request is charged to: the caller's, and — for a route with its own
 * budget — that route's.
 *
 * @fastify/rate-limit keeps one store for every route registered without a per-route
 * `config.rateLimit`, and keys it on this function alone. The overrides above vary
 * only `max`, so without the route in the key every request a user made counted
 * against every limit: a few screens of ordinary GETs and session start (10/min) was
 * already "exhausted" before the user had started anything. Routes without an
 * override still share one counter, which is what the global ceiling means.
 */
function rateLimitKey(request: FastifyRequest): string {
  const credential = credentialKey(request);
  const route = routeKey(request);
  return route !== null && ROUTE_LIMITS[route] ? `${credential}|${route}` : credential;
}

async function rateLimitPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;

  /**
   * Tests share one database and run many requests through one app instance, so real
   * limits would make them fail each other for reasons unrelated to what they assert.
   * The limiter is still REGISTERED under test — only the ceiling is lifted — so the
   * rate-limit tests can build their own app with limits restored.
   */
  const isTest = env.NODE_ENV === 'test';

  let redis: unknown;
  if (env.REDIS_URL) {
    // Redis-backed counters are what make limits hold across processes. Without it
    // each instance counts alone, so N instances means N times the limit.
    const { Redis } = await import('ioredis');
    redis = new Redis(env.REDIS_URL, {
      connectTimeout: 500,
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    });
  } else {
    app.log.warn(
      'REDIS_URL not set: rate limiting is per-process. Correct for one instance, ' +
        'silently permissive once this scales horizontally.',
    );
  }

  await app.register(rateLimit, {
    global: true,
    max: (request) => {
      if (isTest) return 100_000;
      const key = routeKey(request);
      const override = key ? ROUTE_LIMITS[key] : undefined;
      return override?.max ?? GLOBAL_MAX;
    },
    timeWindow: (request) => {
      const key = routeKey(request);
      const override = key ? ROUTE_LIMITS[key] : undefined;
      return override?.timeWindow ?? GLOBAL_WINDOW;
    },
    keyGenerator: rateLimitKey,
    ...(redis ? { redis: redis as never } : {}),

    // Health checks must answer even while something is hammering the API — they are
    // how the platform decides whether to keep this instance in rotation.
    allowList: (request) => request.url.startsWith('/health'),

    // The 429 envelope is NOT built here. @fastify/rate-limit throws its response as
    // an error, which lands in the global error handler anyway — building it in two
    // places is how the rate-limited path ends up shaped differently from every
    // other failure. error-handler.ts owns it; see its 429 branch.

  });
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
