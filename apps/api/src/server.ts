/**
 * Fastify application factory.
 *
 * Kept separate from the process bootstrap so tests can build an app, drive it with
 * `app.inject()` and tear it down without ever binding a port.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './env.js';
import authPlugin, { type AuthPluginOptions } from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import { feedRoutes } from './modules/feed/routes.js';
import { friendRoutes } from './modules/friends/routes.js';
import { gameRoutes } from './modules/game/routes.js';
import { habitRoutes } from './modules/habits/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { moderationRoutes } from './modules/moderation/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { safetyRoutes } from './modules/safety/routes.js';
import { sessionRoutes } from './modules/sessions/routes.js';
import { clerkWebhookRoutes } from './modules/webhooks/clerk.js';

const API_PREFIX = '/v1';

export interface BuildServerOptions {
  /** Auth overrides. Tests inject stub token/identity resolvers here. */
  readonly auth?: Omit<AuthPluginOptions, 'env'>;
}

export async function buildServer(
  env: Env,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
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
  await app.register(authPlugin, { env, ...options.auth });

  await app.register(healthRoutes);

  // Every module below registers its own requireUser preHandler, so order carries no
  // authorisation meaning — it is grouped by concern for readability only.
  await app.register(habitRoutes, { prefix: API_PREFIX });
  await app.register(sessionRoutes, { prefix: API_PREFIX });
  await app.register(profileRoutes, { prefix: API_PREFIX });
  await app.register(friendRoutes, { prefix: API_PREFIX });
  await app.register(feedRoutes, { prefix: API_PREFIX });
  await app.register(gameRoutes, { prefix: API_PREFIX });
  await app.register(notificationRoutes, { prefix: API_PREFIX });
  await app.register(safetyRoutes, { prefix: API_PREFIX });

  // Staff-only. Its own preHandler is requireModerator, not requireUser.
  await app.register(moderationRoutes, { prefix: API_PREFIX });

  // Registered only when a signing secret exists. Without one the route could not
  // verify signatures, and an unverified webhook that writes to the user table is
  // worse than no webhook at all.
  if (env.CLERK_WEBHOOK_SIGNING_SECRET) {
    await app.register(clerkWebhookRoutes, {
      signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
    });
  } else {
    app.log.warn('CLERK_WEBHOOK_SIGNING_SECRET not set: the Clerk webhook route is disabled');
  }

  return app;
}
