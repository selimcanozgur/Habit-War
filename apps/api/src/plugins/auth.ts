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

import type { UserRole } from '@prisma/client';
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
    /** Role of the authenticated user. Empty-ish until requireUser has run. */
    userRole: UserRole;
  }

  interface FastifyInstance {
    requireUser: (request: FastifyRequest) => Promise<void>;
    /** Authenticates, then refuses anyone without a staff role. */
    requireModerator: (request: FastifyRequest) => Promise<void>;
  }
}

const DEV_USER_HEADER = 'x-dev-user-id';

export interface AuthPluginOptions {
  readonly env: Env;
  /** Clock, injected so suspension-expiry tests do not have to wait. */
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
  app.decorateRequest('userRole', 'USER');

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
      attachUser(request, user, null, now());
    });
    app.decorate('requireModerator', moderatorGuard(app));
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
      throw new AppError('UNAUTHORIZED', 'Oturum geçersiz. Tekrar giriş yap.');
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

    const at = now();
    if (!session || session.revokedAt || session.expiresAt <= at) {
      throw new AppError('UNAUTHORIZED', 'Oturum sonlandırılmış. Tekrar giriş yap.');
    }
    if (session.userId !== claims.userId) {
      // A valid signature naming a session that belongs to someone else means the
      // signing key is compromised or a token was hand-assembled. Neither is a
      // request to serve.
      request.log.error(
        { sessionId: claims.sessionId, claimed: claims.userId },
        'token subject does not match its session owner',
      );
      throw new AppError('UNAUTHORIZED', 'Oturum geçersiz. Tekrar giriş yap.');
    }
    if (session.user.deletedAt) {
      throw new AppError('FORBIDDEN', 'Account has been deleted');
    }

    attachUser(request, session.user, session.id, at);
  });

  app.decorate('requireModerator', moderatorGuard(app));
}

/**
 * Routes a suspended account may still reach.
 *
 * Suspension removes the ability to participate, not the right to know why or to
 * leave. Blocking the data export would deny a KVKK/GDPR portability request as a
 * side effect of enforcement, and blocking the profile read would leave the user
 * staring at an error with no explanation of what happened.
 */
const SUSPENSION_EXEMPT: readonly { method: string; path: string }[] = [
  { method: 'GET', path: '/v1/users/me' },
  { method: 'GET', path: '/v1/me/export' },
  { method: 'GET', path: '/v1/me/consents' },
  { method: 'DELETE', path: '/v1/me' },
];

function isSuspensionExempt(request: FastifyRequest): boolean {
  // routerPath carries the registered pattern, not the concrete URL, so a query
  // string or a trailing id cannot be used to slip past the comparison.
  const path = request.routeOptions?.url ?? request.url.split('?')[0] ?? '';
  return SUSPENSION_EXEMPT.some(
    (exempt) => exempt.method === request.method && exempt.path === path,
  );
}

/** Fields the guards need. Kept structural so tests can pass a plain object. */
interface AuthenticatedUser {
  readonly id: string;
  readonly role: UserRole;
  readonly suspendedUntil: Date | null;
  readonly suspensionReason: string | null;
}

/**
 * Puts the resolved identity on the request, refusing suspended accounts.
 *
 * Shared by both auth modes so the suspension rule cannot be enforced in one and
 * forgotten in the other — which is exactly how an enforcement bypass ships.
 */
function attachUser(
  request: FastifyRequest,
  user: AuthenticatedUser,
  sessionId: string | null,
  at: Date,
): void {
  if (user.suspendedUntil && user.suspendedUntil > at && !isSuspensionExempt(request)) {
    throw new AppError('FORBIDDEN', 'Account is suspended', {
      until: user.suspendedUntil.toISOString(),
      reason: user.suspensionReason,
    });
  }

  request.userId = user.id;
  request.sessionId = sessionId;
  request.userRole = user.role;
}

/**
 * Moderator guard.
 *
 * Authenticates first, then checks the role — so an unauthenticated caller gets 401
 * and an authenticated non-moderator gets 403. Collapsing both to 404 would hide the
 * existence of the moderation API, but staff routes are not a secret and the
 * distinction is what makes a misconfigured staff account debuggable.
 */
function moderatorGuard(app: FastifyInstance) {
  return async function requireModerator(request: FastifyRequest): Promise<void> {
    await app.requireUser(request);
    if (request.userRole !== 'MODERATOR' && request.userRole !== 'ADMIN') {
      request.log.warn(
        { userId: request.userId, url: request.url },
        'non-moderator attempted a moderation route',
      );
      throw new AppError('FORBIDDEN', 'Moderator access required');
    }
  };
}

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] });
