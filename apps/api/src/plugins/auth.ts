/**
 * Request authentication.
 *
 * Two modes, chosen by `AUTH_MODE`:
 *
 *  - `clerk`   — verifies a Clerk session JWT from the Authorization header, then
 *                resolves (or provisions) the local User row it maps to.
 *  - `dev`     — trusts an `x-dev-user-id` header. Local work only; `env.ts` refuses
 *                to parse this combination when NODE_ENV is production.
 *
 * Token verification and identity lookup are injected rather than imported directly,
 * so the whole auth path can be exercised in tests without a Clerk tenant. That
 * matters: auth is the one piece where "we'll test it in staging" means shipping it
 * untested.
 */

import { createClerkClient, verifyToken } from '@clerk/backend';
import type { UserRole } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { resolveUser, type ClerkIdentity, type IdentityFetcher } from '../modules/users/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Local User.id. Empty until requireUser has run. */
    userId: string;
    /** Clerk subject for this request, when authenticated through Clerk. */
    clerkId: string | null;
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

/** Verifies a session token and returns the Clerk subject. */
export type TokenVerifier = (token: string) => Promise<string>;

export interface AuthPluginOptions {
  readonly env: Env;
  /** Overrides Clerk JWT verification. Tests inject a stub. */
  readonly verifyTokenFn?: TokenVerifier;
  /** Overrides the Clerk user lookup. Tests inject a stub. */
  readonly fetchIdentityFn?: IdentityFetcher;
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

function clerkVerifier(secretKey: string): TokenVerifier {
  return async (token) => {
    const payload = await verifyToken(token, { secretKey });
    if (!payload.sub) throw new Error('token has no subject');
    return payload.sub;
  };
}

function clerkIdentityFetcher(secretKey: string): IdentityFetcher {
  const clerk = createClerkClient({ secretKey });
  return async (clerkId): Promise<ClerkIdentity> => {
    const user = await clerk.users.getUser(clerkId);
    const primary =
      user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    if (!primary) {
      throw new Error(`Clerk user ${clerkId} has no email address`);
    }
    return {
      clerkId,
      email: primary.emailAddress,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
    };
  };
}

async function authPlugin(app: FastifyInstance, options: AuthPluginOptions): Promise<void> {
  const { env } = options;
  const now = options.now ?? ((): Date => new Date());

  app.decorateRequest('userId', '');
  app.decorateRequest('clerkId', null);
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
      attachUser(request, user, user.clerkId, now());
    });
    app.decorate('requireModerator', moderatorGuard(app));
    return;
  }

  // AUTH_MODE=clerk. env.ts guarantees CLERK_SECRET_KEY is present here.
  const secretKey = env.CLERK_SECRET_KEY as string;
  const verify = options.verifyTokenFn ?? clerkVerifier(secretKey);
  const fetchIdentity = options.fetchIdentityFn ?? clerkIdentityFetcher(secretKey);

  app.decorate('requireUser', async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (!token) {
      throw new AppError('UNAUTHORIZED', 'Missing bearer token');
    }

    let clerkId: string;
    try {
      clerkId = await verify(token);
    } catch (error) {
      request.log.debug({ err: error }, 'token verification failed');
      throw new AppError('UNAUTHORIZED', 'Invalid or expired token');
    }

    let user;
    try {
      user = await resolveUser(app.prisma, clerkId, fetchIdentity);
    } catch (error) {
      // The token is valid but the account cannot be materialised. Surfacing this as
      // a 500 would be honest about the cause but useless to the client, which can
      // only retry; 401 tells it to re-authenticate, which is the right next step.
      request.log.error({ err: error, clerkId }, 'failed to resolve user for a valid token');
      throw new AppError('UNAUTHORIZED', 'Account could not be resolved');
    }

    if (user.deletedAt) {
      throw new AppError('FORBIDDEN', 'Account has been deleted');
    }

    attachUser(request, user, clerkId, now());
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
  clerkId: string | null,
  at: Date,
): void {
  if (user.suspendedUntil && user.suspendedUntil > at && !isSuspensionExempt(request)) {
    throw new AppError('FORBIDDEN', 'Account is suspended', {
      until: user.suspendedUntil.toISOString(),
      reason: user.suspensionReason,
    });
  }

  request.userId = user.id;
  request.clerkId = clerkId;
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
