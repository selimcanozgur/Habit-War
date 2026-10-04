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
  return apiRequest<AuthResponse>('/v1/auth/sign-up', {
    method: 'POST',
    authenticated: false,
    body: { email, password },
  });
}

export function signIn(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/v1/auth/sign-in', {
    method: 'POST',
    authenticated: false,
    body: { email, password },
  });
}

/** Exchanges a Google ID token for a session. */
export function signInWithGoogle(idToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/v1/auth/google', { method: 'POST', body: { idToken }, authenticated: false });
}

export function signInWithApple(idToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/v1/auth/apple', { method: 'POST', body: { idToken }, authenticated: false });
}

export function refreshSession(refreshToken: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/v1/auth/refresh', { method: 'POST', body: { refreshToken }, authenticated: false });
}

export function signOut(refreshToken: string): Promise<void> {
  return apiRequest<void>('/v1/auth/sign-out', { method: 'POST', body: { refreshToken }, authenticated: false });
}

export function requestPasswordReset(email: string): Promise<void> {
  return apiRequest<void>('/v1/auth/forgot-password', { method: 'POST', body: { email }, authenticated: false });
}

export function resendVerification(email: string): Promise<void> {
  return apiRequest<void>('/v1/auth/resend-verification', { method: 'POST', body: { email }, authenticated: false });
}
