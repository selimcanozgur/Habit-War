/**
 * Request bodies for the auth routes.
 *
 * The password is bounded but not pattern-checked here: strength is decided in one
 * place, `checkPasswordStrength`, so the rule cannot drift between the signup route
 * and the reset route. What this file enforces is shape — that a password field is a
 * string of plausible size, so a megabyte of text never reaches the hasher.
 */

import { z } from 'zod';

import { PASSWORD_MAX_LENGTH } from './password.js';

/**
 * Email.
 *
 * Lowercased and trimmed at the edge, so every lookup downstream compares like with
 * like. `Ali@x.com` and `ali@x.com` are one address, and treating them as two makes
 * an account the user cannot sign in to.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Geçerli bir e-posta adresi gir.')
  .max(254);

/** Bounded only. The strength rules live in password.ts. */
const password = z.string().min(1, 'Şifre gerekli.').max(PASSWORD_MAX_LENGTH);

export const signUpBody = z.object({ email, password });

export const signInBody = z.object({ email, password });

export const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

export const signOutBody = z.object({
  refreshToken: z.string().min(1),
});

/**
 * Provider sign-in.
 *
 * Only the token is accepted. An `email` field here would be a field the client
 * controls, and the whole point of verifying the token server-side is that the
 * client's claims about itself carry no weight.
 */
export const providerSignInBody = z.object({
  idToken: z.string().min(1),
});

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  token: z.string().min(1),
  password,
});

export const verifyEmailBody = z.object({
  token: z.string().min(1),
});

export const resendVerificationBody = z.object({ email });
