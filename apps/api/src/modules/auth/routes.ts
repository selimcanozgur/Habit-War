/**
 * Auth routes.
 *
 * Public by design — these are the routes a caller reaches *before* they have an
 * identity, so `requireUser` must not be hooked onto this plugin. Only `/auth/me`
 * and the sign-out-everywhere route authenticate, and they do it individually.
 *
 * Rate limiting matters more here than anywhere else in the API: sign-in is where a
 * credential-stuffing run lands, and the password-reset route is where someone would
 * try to use our mail server to flood an address they do not own. Both are given
 * tighter limits than the global default.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '../../lib/errors.js';

import { AuthService, type DeviceContext } from './service.js';
import type { ProviderVerifier } from './providers.js';
import {
  forgotPasswordBody,
  providerSignInBody,
  refreshBody,
  resendVerificationBody,
  resetPasswordBody,
  signInBody,
  signOutBody,
  signUpBody,
  verifyEmailBody,
} from './schemas.js';

export interface AuthRouteOptions {
  readonly service: AuthService;
  /** Null when the provider is not configured; its routes are then not registered. */
  readonly verifyGoogle: ProviderVerifier | null;
  readonly verifyApple: ProviderVerifier | null;
}

/**
 * How many attempts per window the credential routes allow.
 *
 * Deliberately small. A human signing in mistypes two or three times; a hundred
 * attempts in five minutes is a script. The limiter keys on the credential rather
 * than the user id, because at this point in the request there is no user id.
 */
const CREDENTIAL_LIMIT = { max: 10, timeWindow: '5 minutes' } as const;

/** Tighter still: each of these sends an email, so abuse costs someone else's inbox. */
const MAIL_LIMIT = { max: 3, timeWindow: '15 minutes' } as const;

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const { service } = options;

  app.post(
    '/auth/sign-up',
    { config: { rateLimit: CREDENTIAL_LIMIT } },
    async (request, reply) => {
      const body = signUpBody.parse(request.body);
      const result = await service.signUp({ ...body, device: deviceOf(request) });
      reply.code(201);
      return present(result);
    },
  );

  app.post('/auth/sign-in', { config: { rateLimit: CREDENTIAL_LIMIT } }, async (request) => {
    const body = signInBody.parse(request.body);
    const result = await service.signIn({ ...body, device: deviceOf(request) });
    return present(result);
  });

  /**
   * Refresh is limited far more loosely than sign-in: a legitimate client calls it
   * every fifteen minutes, and the token itself is the secret — there is nothing to
   * guess at this entropy.
   */
  app.post('/auth/refresh', async (request) => {
    const body = refreshBody.parse(request.body);
    const result = await service.refresh({
      refreshToken: body.refreshToken,
      device: deviceOf(request),
    });
    return present(result);
  });

  app.post('/auth/sign-out', async (request, reply) => {
    const body = signOutBody.parse(request.body);
    await service.signOut(body.refreshToken);
    reply.code(204);
  });

  /** Ends every session. Authenticated, because it acts on the whole account. */
  app.post(
    '/auth/sign-out-all',
    { preHandler: app.requireUser },
    async (request, reply) => {
      await service.signOutEverywhere(request.userId);
      reply.code(204);
    },
  );

  // ------------------------------------------------------------- providers

  if (options.verifyGoogle) {
    const verify = options.verifyGoogle;
    app.post('/auth/google', { config: { rateLimit: CREDENTIAL_LIMIT } }, async (request) => {
      const body = providerSignInBody.parse(request.body);
      const claims = await verifyProviderToken(request, verify, body.idToken);
      const result = await service.signInWithProvider({
        provider: 'GOOGLE',
        ...claims,
        device: deviceOf(request),
      });
      return present(result);
    });
  }

  if (options.verifyApple) {
    const verify = options.verifyApple;
    app.post('/auth/apple', { config: { rateLimit: CREDENTIAL_LIMIT } }, async (request) => {
      const body = providerSignInBody.parse(request.body);
      const claims = await verifyProviderToken(request, verify, body.idToken);
      const result = await service.signInWithProvider({
        provider: 'APPLE',
        ...claims,
        device: deviceOf(request),
      });
      return present(result);
    });
  }

  // ----------------------------------------------------------- email flows

  /**
   * Always 204, whether or not the address has an account.
   *
   * Returning 404 for an unknown address would turn this route into a free user
   * enumerator — post a list of addresses, keep the ones that come back 204.
   */
  app.post('/auth/forgot-password', { config: { rateLimit: MAIL_LIMIT } }, async (request, reply) => {
    const body = forgotPasswordBody.parse(request.body);
    await service.requestPasswordReset(body.email);
    reply.code(204);
  });

  app.post(
    '/auth/reset-password',
    { config: { rateLimit: CREDENTIAL_LIMIT } },
    async (request, reply) => {
      const body = resetPasswordBody.parse(request.body);
      await service.resetPassword(body);
      reply.code(204);
    },
  );

  app.post('/auth/verify-email', async (request, reply) => {
    const body = verifyEmailBody.parse(request.body);
    await service.verifyEmail(body.token);
    reply.code(204);
  });

  app.post(
    '/auth/resend-verification',
    { config: { rateLimit: MAIL_LIMIT } },
    async (request, reply) => {
      const body = resendVerificationBody.parse(request.body);
      await service.resendVerification(body.email);
      reply.code(204);
    },
  );
}

/**
 * Turns a provider verification failure into a 401.
 *
 * The underlying error says useful things — wrong audience, expired, unknown key —
 * and none of them belong in a response: they describe our configuration, not the
 * caller's mistake. They go to the log instead.
 */
async function verifyProviderToken(
  request: FastifyRequest,
  verify: ProviderVerifier,
  idToken: string,
): ReturnType<ProviderVerifier> {
  try {
    return await verify(idToken);
  } catch (error) {
    request.log.warn({ err: error }, 'provider token verification failed');
    throw new AppError('UNAUTHORIZED', 'Giriş doğrulanamadı. Tekrar dene.');
  }
}

/** What goes in the device list the user can review. Display-only, never trusted. */
function deviceOf(request: FastifyRequest): DeviceContext {
  const header = request.headers['user-agent'];
  return {
    userAgent: Array.isArray(header) ? header[0] : header,
    ipAddress: request.ip,
  };
}

/**
 * Shapes the response.
 *
 * The user row is trimmed to what a client needs at sign-in. Returning the whole row
 * would leak `passwordHash` to every caller — the kind of mistake that is invisible
 * until someone reads a response body.
 */
function present(result: Awaited<ReturnType<AuthService['signIn']>>): unknown {
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    user: {
      id: result.user.id,
      username: result.user.username,
      displayName: result.user.displayName,
      email: result.user.email,
      avatarUrl: result.user.avatarUrl,
      emailVerified: result.user.emailVerifiedAt !== null,
    },
  };
}
