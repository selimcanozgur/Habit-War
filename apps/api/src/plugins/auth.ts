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
  }

  interface FastifyInstance {
    requireUser: (request: FastifyRequest) => Promise<void>;
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

  app.decorateRequest('userId', '');
  app.decorateRequest('clerkId', null);

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
      request.clerkId = user.clerkId;
    });
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

    request.userId = user.id;
    request.clerkId = clerkId;
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['prisma'] });
