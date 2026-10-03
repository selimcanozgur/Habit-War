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
import corsPlugin from './plugins/cors.js';
import prismaPlugin from './plugins/prisma.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import securityHeadersPlugin from './plugins/security-headers.js';
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
import { authRoutes } from './modules/auth/routes.js';
import { createMailSender } from './modules/auth/mail.js';
import { appleVerifier, googleVerifier } from './modules/auth/providers.js';
import { AuthService } from './modules/auth/service.js';

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
  await app.register(securityHeadersPlugin, { env });
  await app.register(corsPlugin, { env });
  // Registered before auth so an unauthenticated flood is rejected without a
  // database read; the limiter falls back to IP when there is no user yet.
  await app.register(rateLimitPlugin, { env });
  await app.register(prismaPlugin);
  await app.register(authPlugin, { env, ...options.auth });

  await app.register(healthRoutes);

  /*
    Auth is registered before every other module because it is the only one whose
    routes must work without an identity. Its own routes opt into `requireUser`
    individually rather than through a plugin-wide hook.
  */
  await app.register(buildAuthRoutes(app, env), { prefix: API_PREFIX });

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

  return app;
}

/**
 * Wires the auth module from configuration.
 *
 * A provider with no client ids configured gets no route at all, rather than a route
 * that always fails: a 404 says "this build has no Google sign-in", while a 401 from
 * an unconfigured verifier would look like the user's credentials were wrong.
 */
function buildAuthRoutes(app: FastifyInstance, env: Env) {
  const service = new AuthService({
    prisma: app.prisma,
    jwtSecret: new TextEncoder().encode(env.AUTH_JWT_SECRET ?? 'dev-secret-not-used-in-dev-mode'),
    sendMail: createMailSender({
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
      appUrl: env.APP_URL,
      logger: app.log,
    }),
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
  });

  const googleIds = splitIds(env.GOOGLE_CLIENT_IDS);
  const appleIds = splitIds(env.APPLE_CLIENT_IDS);

  if (googleIds.length === 0) app.log.warn('GOOGLE_CLIENT_IDS not set: Google sign-in is disabled');
  if (appleIds.length === 0) app.log.warn('APPLE_CLIENT_IDS not set: Apple sign-in is disabled');

  return async (instance: FastifyInstance): Promise<void> => {
    await authRoutes(instance, {
      service,
      verifyGoogle: googleIds.length > 0 ? googleVerifier(googleIds) : null,
      verifyApple: appleIds.length > 0 ? appleVerifier(appleIds) : null,
    });
  };
}

function splitIds(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}
