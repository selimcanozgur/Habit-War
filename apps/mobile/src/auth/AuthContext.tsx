/**
 * Who is signed in, and how every request gets a token.
 *
 * One provider owns the session, and it does three things no screen should have to
 * think about:
 *
 *  - Restores the stored session on launch, so a returning user does not meet a
 *    sign-in screen they already passed.
 *  - Hands the API client a fresh access token for every request, refreshing it when
 *    it has expired. Screens call `listHabits()` and never see a token.
 *  - Signs out when the refresh itself fails, which is the only honest response to a
 *    revoked or expired session.
 *
 * Refreshes are deduplicated through a single in-flight promise. Five queries firing
 * at once on a cold launch would otherwise each start their own refresh, and because
 * the server rotates on every refresh, four of them would come back with a token that
 * had already been replaced — the server would read that as a replay and revoke the
 * whole family, signing the user out for doing nothing but opening the app.
 */

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  refreshSession,
  signIn as signInRequest,
  signInWithApple as appleRequest,
  signInWithGoogle as googleRequest,
  signOut as signOutRequest,
  signUp as signUpRequest,
  type AuthResponse,
  type AuthUser,
} from '../api/auth';
import { ApiError, setAuthHeaderProvider } from '../api/client';
import { clearSession, loadSession, saveSession } from './storage';

interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly user: AuthUser;
}

export interface AuthContextValue {
  /** Null while signed out; the user once signed in. */
  readonly user: AuthUser | null;
  /** True until the stored session has been read — the splash condition. */
  readonly isRestoring: boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signUp: (email: string, password: string) => Promise<void>;
  readonly signInWithGoogle: (idToken: string) => Promise<void>;
  readonly signInWithApple: (idToken: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Refresh this long before the token actually expires.
 *
 * A token that expires while a request is in flight comes back 401, and the user
 * sees a failure for no reason of their own. Thirty seconds covers a slow network
 * without refreshing more often than necessary.
 */
const EXPIRY_MARGIN_MS = 30_000;

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const queryClient = useQueryClient();

  /*
    The session is mirrored in a ref because the header provider below is registered
    once and must read the *current* session, not the one captured when it was
    registered. State alone would give every request the session from first render.
  */
  const sessionRef = useRef<Session | null>(null);
  const refreshInFlight = useRef<Promise<Session | null> | null>(null);

  const apply = useCallback(async (response: AuthResponse): Promise<Session> => {
    const next: Session = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      user: response.user,
    };
    sessionRef.current = next;
    setSession(next);
    await saveSession({ accessToken: next.accessToken, refreshToken: next.refreshToken });
    return next;
  }, []);

  const forget = useCallback(async (): Promise<void> => {
    sessionRef.current = null;
    setSession(null);
    // Nothing of this account may outlive it on the device: the next one to sign in
    // would otherwise see its books and its progress until each
    // query happened to refetch — and skip its own first-run flow on a stale profile.
    queryClient.clear();
    await clearSession();
  }, [queryClient]);

  /**
   * Returns a usable session, refreshing first if the token is spent.
   *
   * Everything funnels through the one in-flight promise; see the note at the top of
   * this file for why that matters.
   */
  const ensureFresh = useCallback(async (): Promise<Session | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    if (Date.now() < current.expiresAt - EXPIRY_MARGIN_MS) return current;

    refreshInFlight.current ??= (async (): Promise<Session | null> => {
      try {
        const response = await refreshSession(current.refreshToken);
        return await apply(response);
      } catch (error) {
        // A network failure is not a dead session: the user is on a train, and
        // signing them out would lose their place for a reason that will resolve
        // itself. Only the server's own rejection means the session is gone.
        if (error instanceof ApiError && error.code === 'NETWORK') {
          return current;
        }
        await forget();
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();

    return refreshInFlight.current;
  }, [apply, forget]);

  /*
    Registered once, for the life of the app. Every API call lands here, so this is
    the single place a token is attached — no screen and no query has to know.
  */
  useEffect(() => {
    setAuthHeaderProvider(async () => {
      const live = await ensureFresh();
      const headers: Record<string, string> = {};
      if (live) headers['authorization'] = `Bearer ${live.accessToken}`;
      return headers;
    });
  }, [ensureFresh]);

  /*
    Launch. The stored tokens are adopted with an expiry of zero, which marks the
    access token as spent and makes the first request refresh it. Storing the real
    expiry would mean trusting a clock that may have moved since the app was closed.
  */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await loadSession();
      if (cancelled) return;

      if (!stored) {
        setIsRestoring(false);
        return;
      }

      sessionRef.current = {
        ...stored,
        expiresAt: 0,
        user: { id: '', username: '', displayName: '', email: '', avatarUrl: null, emailVerified: false },
      };

      try {
        const response = await refreshSession(stored.refreshToken);
        if (!cancelled) await apply(response);
      } catch {
        if (!cancelled) await forget();
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apply, forget]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isRestoring,
      signIn: async (email, password) => {
        await apply(await signInRequest(email, password));
      },
      signUp: async (email, password) => {
        await apply(await signUpRequest(email, password));
      },
      signInWithGoogle: async (idToken) => {
        await apply(await googleRequest(idToken));
      },
      signInWithApple: async (idToken) => {
        await apply(await appleRequest(idToken));
      },
      signOut: async () => {
        const token = sessionRef.current?.refreshToken;
        // Cleared locally first, and the server told afterwards. If the network call
        // fails the user is still signed out of this device, which is what they
        // asked for; the server-side session expires on its own.
        await forget();
        if (token) {
          try {
            await signOutRequest(token);
          } catch {
            // Nothing to show. The local session is already gone.
          }
        }
      },
    }),
    [session, isRestoring, apply, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
