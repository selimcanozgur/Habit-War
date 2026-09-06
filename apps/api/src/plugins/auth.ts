/**
 * Request authentication.
 *
 * PHASE 0 PLACEHOLDER. Clerk is the chosen provider (spec §6.1) but wiring it needs
 * a real tenant, a JWKS verification step and a webhook that keeps User.clerkId in
 * sync. Until then a development-only header identifies the caller.
 *
 * The guard is deliberately loud: outside development this refuses to start rather
 * than silently accepting an unauthenticated header. A dev shortcut that survives
 * into production is how auth bypasses ship.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const DEV_USER_HEADER = 'x-dev-user-id';

async function authPlugin(app: FastifyInstance): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    throw new Error(
      'auth plugin: development header auth cannot run in production. ' +
        'Wire Clerk JWT verification before deploying.',
    );
  }

  app.decorateRequest('userId', '');

  app.decorate('requireUser', async (request: FastifyRequest) => {
    const header = request.headers[DEV_USER_HEADER];
    const userId = Array.isArray(header) ? header[0] : header;
    if (!userId) {
      throw new AppError('UNAUTHORIZED', `Missing ${DEV_USER_HEADER} header (development auth)`);
    }
    request.userId = userId;
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(authPlugin, { name: 'auth' });
