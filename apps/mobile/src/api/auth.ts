/**
 * The auth endpoints.
 *
 * Kept apart from the rest of the API surface because these are the only calls that
 * run without a session — and because `refresh` is called from inside the client's
 * own retry path, so routing it through the same wrapper that triggers a refresh
 * would recurse.
 */

import { apiRequest } from './client';

/** What the server returns on sign-up, sign-in and refresh. */
export interface AuthResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds the access token is good for. */
  readonly expiresIn: number;
  readonly user: AuthUser;
}

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly emailVerified: boolean;
}

export function signUp(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/sign-up', {
    method: 'POST',
    body: { email, password },
  });
}

export function signIn(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/sign-in', {
    method: 'POST',
    body: { email, password },
  });
}

/** Exchanges a Google ID token for a session. */
export function signInWithGoogle(idToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/google', { method: 'POST', body: { idToken } });
}

export function signInWithApple(idToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/apple', { method: 'POST', body: { idToken } });
}

export function refreshSession(refreshToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/refresh', { method: 'POST', body: { refreshToken } });
}

export function signOut(refreshToken: string): Promise<void> {
  return apiRequest<void>('/auth/sign-out', { method: 'POST', body: { refreshToken } });
}

export function requestPasswordReset(email: string): Promise<void> {
  return apiRequest<void>('/auth/forgot-password', { method: 'POST', body: { email } });
}

export function resendVerification(email: string): Promise<void> {
  return apiRequest<void>('/auth/resend-verification', { method: 'POST', body: { email } });
}
