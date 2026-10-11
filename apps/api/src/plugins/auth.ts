/**
 * Request authentication.
 *
 * Two modes, chosen by `AUTH_MODE`:
 *
 *  - `token` — verifies this product's own access token, a short-lived HS256 JWT,
 *              and loads the User row it names.
 *  - `dev`   — trusts an `x-dev-user-id` header. Local work only; `env.ts` refuses
 *              to parse this combination when NODE_ENV is production.
 *
 * The access token carries the session it was minted from, and that session is
 * checked on every request. Skipping the check would make the token stateless and
 * every request cheaper — and would also mean "sign out my stolen phone" did
 * nothing for fifteen minutes. The lookup is one indexed read; the guarantee is
 * worth it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Local User.id. Empty until requireUser has run. */
    userId: string;
    /** Session this request's token was minted from. Null under dev auth. */
    sessionId: string | null;
  }

  interface FastifyInstance {
    requireUser: (request: FastifyRequest) => Promise<void>;
  }
}

const DEV_USER_HEADER = 'x-dev-user-id';

export interface AuthPluginOptions {
  readonly env: Env;
  /** Clock, injected so session-expiry tests do not have to wait. */
  readonly now?: () => Date;
}

/** Pulls the bearer token out of the Authorization header. */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const { env } = options;
  const now = options.now ?? ((): Date => new Date());

  app.decorateRequest('userId', '');
  app.decorateRequest('sessionId', null);

  if (env.AUTH_MODE === 'dev') {
    app.log.warn('AUTH_MODE=dev: requests are authenticated by the x-dev-user-id header');

    app.decorate('requireUser', async (request: FastifyRequest) => {
      const header = request.headers[DEV_USER_HEADER];
      const userId = Array.isArray(header) ? header[0] : header;
      if (!userId) {
        throw new AppError('UNAUTHORIZED', `Missing ${DEV_USER_HEADER} header (dev auth mode)`);
      }
      const user = await app.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
      if (!user) {
        throw new AppError('UNAUTHORIZED', 'Unknown user id');
      }
      request.userId = user.id;
      request.sessionId = null;
    });
    return;
  }

  // AUTH_MODE=token. env.ts guarantees AUTH_JWT_SECRET is present here.
  const secret = new TextEncoder().encode(env.AUTH_JWT_SECRET as string);

  app.decorate('requireUser', async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) {
      throw new AppError('UNAUTHORIZED', 'Missing bearer token');
    }

    let claims;
    try {
      claims = await verifyAccessToken(token, secret);
    } catch (error) {
      request.log.debug({ err: error }, 'access token verification failed');
      throw new AppError('UNAUTHORIZED', 'Session is invalid. Sign in again.');
    }

    /*
      One read, both checks. The session must still be live, which is what makes
      sign-out take effect before the access token's own expiry; and the user is
      loaded from it rather than looked up separately, so a revoked session cannot
      be paired with a still-valid user row.
    */
    const session = await app.prisma.authSession.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt <= now()) {
      throw new AppError('UNAUTHORIZED', 'Session has ended. Sign in again.');
    }
    if (session.userId !== claims.userId) {
      // A valid signature naming a session that belongs to someone else means the
      // signing key is compromised or a token was hand-assembled. Neither is a
      // request to serve.
      request.log.error(
        { sessionId: claims.sessionId, claimed: claims.userId },
        'token subject does not match its session owner',
      );
      throw new AppError('UNAUTHORIZED', 'Session is invalid. Sign in again.');
    }
    if (session.user.deletedAt) {
      throw new AppError('FORBIDDEN', 'Account has been deleted');
    }

    request.userId = session.user.id;
    request.sessionId = session.id;
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] });
