/**
 * Environment configuration.
 *
 * Parsed and validated once at boot. A missing or malformed variable must crash the
 * process immediately — a server that starts with a broken DATABASE_URL and fails on
 * the first request is strictly worse than one that never starts.
 */

import { z } from 'zod';

/**
 * How requests are authenticated.
 *
 * `dev` trusts an `x-dev-user-id` header and exists only so the API can be driven
 * locally without a Clerk tenant. It is rejected outright when NODE_ENV is
 * production — a development shortcut that survives a deploy is how auth bypasses
 * ship.
 */
const authMode = z.enum(['token', 'dev']);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    AUTH_MODE: authMode.default('token'),

    /**
     * Secret the access tokens are signed with. Required when AUTH_MODE=token.
     *
     * 32 characters minimum because an HS256 key shorter than the hash it feeds is
     * the weak link in the whole scheme. Rotating it signs every live user out,
     * which is the intended behaviour if it is ever believed to have leaked.
     */
    AUTH_JWT_SECRET: z.string().min(32).optional(),

    /**
     * Whether a new password account must confirm its address before signing in.
     *
     * Off by default so local work needs no mail server. It belongs on in
     * production: without it, anyone can register under an address they do not own
     * and receive that person's notifications.
     */
    REQUIRE_EMAIL_VERIFICATION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /**
     * Google OAuth client ids, comma-separated.
     *
     * A list because one Google project issues a different id per platform; a token
     * minted for any of them is legitimately this app's. Absent means the Google
     * route is not registered at all, rather than registered and always failing.
     */
    GOOGLE_CLIENT_IDS: z.string().optional(),

    /** Apple Services ID / bundle ids, comma-separated. Same reasoning as Google. */
    APPLE_CLIENT_IDS: z.string().optional(),

    /** Where password-reset and verification links point. */
    APP_URL: z.string().url().default('http://localhost:8081'),

    /** Resend API key. Without it, mails are logged instead of sent. */
    RESEND_API_KEY: z.string().min(1).optional(),

    /** From address for transactional mail. */
    MAIL_FROM: z.string().default('Habit War <onboarding@resend.dev>'),

    /**
     * Comma-separated origins allowed to call this API from a browser.
     * Empty in development, where any localhost/LAN origin is accepted instead.
     */
    CORS_ORIGINS: z.string().optional(),

    /** Raises the Google Books quota for book search. Search works without it. */
    GOOGLE_BOOKS_API_KEY: z.string().min(1).optional(),


  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'token' && !env.AUTH_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_JWT_SECRET'],
        message:
          'required when AUTH_MODE=token (set AUTH_MODE=dev for local work without real sign-in)',
      });
    }
    if (env.NODE_ENV === 'production' && !env.REQUIRE_EMAIL_VERIFICATION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REQUIRE_EMAIL_VERIFICATION'],
        message:
          'must be true in production: otherwise anyone can register under an address they do not own',
      });
    }
    if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'required in production: password reset depends on outbound mail',
      });
    }
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_MODE'],
        message: 'dev header auth cannot run in production',
      });
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * What the background worker needs.
 *
 * A strict subset, and deliberately so: the worker authenticates nobody, so it has
 * no use for the token signing secret and should not be handed one. Validating the
 * full API schema there would have made `AUTH_JWT_SECRET` a hard requirement for
 * starting a process that signs no tokens — which means deploying the worker with a
 * credential it cannot need, in a process whose whole job is to run unattended.
 */
const workerSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type WorkerEnv = z.infer<typeof workerSchema>;

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}

/** Same contract as `loadEnv`, restricted to what the worker actually reads. */
export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = workerSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid worker configuration:\n${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}
