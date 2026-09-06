/**
 * Fastify application factory.
 *
 * Kept separate from the process bootstrap so tests can build an app, drive it with
 * `app.inject()` and tear it down without ever binding a port.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './env.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import { habitRoutes } from './modules/habits/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { sessionRoutes } from './modules/sessions/routes.js';

const API_PREFIX = '/v1';

export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Trust the proxy so rate limiting and logging see the real client address.
    trustProxy: true,
  });

  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(habitRoutes, { prefix: API_PREFIX });
  await app.register(sessionRoutes, { prefix: API_PREFIX });

  return app;
}
