/**
 * CORS.
 *
 * Native clients do not enforce CORS, so this is invisible until someone opens the
 * app in a browser — which is exactly how it was found: every request failed at the
 * preflight while the UI rendered perfectly and reported "cannot reach the server".
 *
 * The allowed origins differ sharply by environment, and deliberately so:
 *
 *  - In development, Expo's web target is served from an arbitrary localhost port and
 *    the dev server may be reached over the LAN IP from a phone, so any localhost or
 *    private-network origin is accepted. This is a development convenience and is not
 *    reachable in production because the branch does not run there.
 *  - In production, only origins named in CORS_ORIGINS are accepted. There is no
 *    wildcard: `credentials` is on, and a wildcard with credentials is the
 *    configuration that lets any site read an authenticated response.
 */

import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';

/** localhost / 127.0.0.1 / private LAN ranges, any port. Development only. */
const LOCAL_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

async function corsPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;
  const allowed = env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];

  await app.register(cors, {
    origin: (origin, callback) => {
      // A same-origin or non-browser request (curl, the native app) sends no Origin.
      if (!origin) return callback(null, true);

      if (allowed.includes(origin)) return callback(null, true);
      if (env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin)) return callback(null, true);

      // Refused by answering "not allowed" rather than by throwing: a rejected
      // preflight should be a clean CORS failure in the browser, not a 500 in the logs.
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // `x-dev-user-id` is listed because the development auth mode travels in it; it is
    // useless in production, where that mode refuses to start.
    allowedHeaders: ['authorization', 'content-type', 'x-dev-user-id'],
    exposedHeaders: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'],
    maxAge: 86_400,
  });
}

export default fp(corsPlugin, { name: 'cors' });
