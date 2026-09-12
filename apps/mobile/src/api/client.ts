/**
 * API client.
 *
 * Thin on purpose: one fetch wrapper that knows the base URL, the auth header and
 * the error envelope the API actually returns. Everything else is a typed function
 * in a sibling module.
 */

import Constants from 'expo-constants';

/**
 * Base URL.
 *
 * `localhost` only means "this machine" on a simulator. On a physical device it
 * means the phone itself, so the dev server host is read from the Expo manifest —
 * that is the address the phone already reached to load the bundle.
 */
function resolveBaseUrl(): string {
  const configured = Constants.expoConfig?.extra?.['apiUrl'] as string | undefined;
  const hostUri = Constants.expoConfig?.hostUri;

  if (configured && !configured.includes('localhost')) return configured;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:3000`;
  }
  return configured ?? 'http://localhost:3000';
}

export const API_BASE_URL = resolveBaseUrl();

/** Mirrors the API's error envelope: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when retrying the same request might succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

/** Supplies the auth header. Swapped for Clerk's token getter once sign-in exists. */
export type AuthHeaderProvider = () => Promise<Record<string, string>>;

let authHeaderProvider: AuthHeaderProvider = async () => ({});

export function setAuthHeaderProvider(provider: AuthHeaderProvider): void {
  authHeaderProvider = provider;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(await authHeaderProvider()),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    // fetch rejects only on network failure; give that its own code so the UI can
    // say "you're offline" rather than "something went wrong".
    throw new ApiError(0, 'NETWORK', 'Sunucuya ulaşılamadı', error);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'UNKNOWN',
      envelope?.error?.message ?? `İstek başarısız (${response.status})`,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
