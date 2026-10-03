/**
 * Where the tokens live between launches.
 *
 * SecureStore on a device: the iOS Keychain and Android's EncryptedSharedPreferences,
 * which is the right home for a credential that stays valid for sixty days. A refresh
 * token in AsyncStorage sits in plain text in the app's sandbox, readable by anything
 * that gets at the filesystem on a rooted or jailbroken phone.
 *
 * SecureStore does not exist on web, where this app also runs for development, so
 * that target falls back to localStorage. That is a real downgrade — localStorage is
 * readable by any script that manages to run on the origin — and it is accepted
 * because the web build is a preview rather than a shipped surface.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_KEY = 'habitwar.accessToken';
const REFRESH_KEY = 'habitwar.refreshToken';

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
}

const isWeb = Platform.OS === 'web';

/**
 * Every operation swallows its errors.
 *
 * Storage can fail for reasons that have nothing to do with this app — a locked
 * keychain, a private browsing window, a device with site data blocked. None of them
 * should crash the app on launch; the worst outcome of a failed read is a sign-in
 * screen, which is a state the app already knows how to be in.
 */
async function readKey(key: string): Promise<string | null> {
  try {
    if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeKey(key: string, value: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // A session that cannot be persisted still works until the app is closed, which
    // is better than refusing the sign-in that just succeeded.
  }
}

async function deleteKey(key: string): Promise<void> {
  try {
    if (isWeb) globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing useful to do. The caller has already cleared its in-memory copy, so
    // this app is signed out either way.
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken] = await Promise.all([
    readKey(ACCESS_KEY),
    readKey(REFRESH_KEY),
  ]);
  // Both or neither: an access token with no refresh token is fifteen minutes from
  // being useless, and treating that as a session would strand the user mid-task.
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    writeKey(ACCESS_KEY, session.accessToken),
    writeKey(REFRESH_KEY, session.refreshToken),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([deleteKey(ACCESS_KEY), deleteKey(REFRESH_KEY)]);
}
