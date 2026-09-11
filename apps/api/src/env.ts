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
const authMode = z.enum(['clerk', 'dev']);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    AUTH_MODE: authMode.default('clerk'),

    /** Clerk secret key (`sk_test_…` / `sk_live_…`). Required when AUTH_MODE=clerk. */
    CLERK_SECRET_KEY: z.string().min(1).optional(),

    /**
     * Signing secret for the Clerk webhook (`whsec_…`).
     * Optional: without it the webhook route is not registered at all, rather than
     * registered in a state where it would accept unsigned payloads.
     */
    CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'clerk' && !env.CLERK_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLERK_SECRET_KEY'],
        message: 'required when AUTH_MODE=clerk (set AUTH_MODE=dev for local work without Clerk)',
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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
