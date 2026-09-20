/**
 * Feed, post, like, report and block endpoints.
 *
 * Types here are deliberately defensive. The feed is written by another workstream
 * and the API is still moving, so anything the UI can survive without is optional and
 * every list is normalised before it leaves this module. A missing `digestStats` on a
 * digest post should degrade to a plainer card, never crash the tab.
 */

import { apiRequest } from './client.js';

/**
 * Post kinds the spec defines (§5.1).
 *
 * Kept as a string union plus a catch-all so an unknown type the server starts
 * emitting renders as a plain text card instead of an empty hole in the list.
 */
export type PostType =
  | 'SESSION_COMPLETE'
  | 'DAILY_DIGEST'
  | 'LEVEL_UP'
  | 'ACHIEVEMENT'
  | 'CHALLENGE_RESULT'
  | 'TEXT'
  | 'IMAGE';

export type FeedScope = 'friends' | 'discover';

export interface PostAuthor {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly level: number;
}

/**
 * Roll-up numbers attached to a `DAILY_DIGEST`.
 *
 * The spec's answer to feed spam is that automatic session posts collapse into one
 * daily digest, so this is the payload that makes "3 seans, 145 XP" renderable
 * without the client having to aggregate anything itself.
 */
export interface DigestStats {
  readonly sessionCount: number;
  readonly totalMinutes: number;
  readonly totalXp: number;
  /** Optional highlight, e.g. the habit with the most minutes that day. */
  readonly topHabitName?: string | undefined;
}

/** Per-session detail on a `SESSION_COMPLETE` post: one session, not a day. */
export interface SessionStats {
  readonly habitName?: string | undefined;
  readonly durationMinutes?: number | undefined;
  readonly xp?: number | undefined;
}

export interface Post {
  readonly id: string;
  readonly type: PostType;
  readonly content: string;
  readonly mediaUrls: readonly string[];
  readonly likeCount: number;
  readonly replyCount: number;
  /** ISO timestamp. */
  readonly createdAt: string;
  readonly likedByMe: boolean;
  /** ISO date (YYYY-MM-DD) the digest covers. Only on `DAILY_DIGEST`. */
  readonly digestDate?: string | undefined;
  readonly digestStats?: DigestStats | undefined;
  /** Only on `SESSION_COMPLETE`; absent servers fall back to parsing nothing. */
  readonly sessionStats?: SessionStats | undefined;
  /** Only on `LEVEL_UP`. */
  readonly level?: number | undefined;
  /** Only on `ACHIEVEMENT`. */
  readonly achievementName?: string | undefined;
  readonly author: PostAuthor;
}

export interface FeedPage {
  readonly posts: readonly Post[];
  /** `null` means the end of the list — the query stops paging on it. */
  readonly nextCursor: string | null;
}

export type ReportReason = 'SPAM' | 'HARASSMENT' | 'HATE' | 'SEXUAL' | 'VIOLENCE' | 'OTHER';

/* ------------------------------------------------------------------ *
 * Normalisation
 *
 * The server is another team's work in progress. Rather than sprinkle `?? []` and
 * `?? 0` through every component, the shape is repaired once here so components can
 * treat `Post` as a total type.
 * ------------------------------------------------------------------ */

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normaliseAuthor(raw: unknown): PostAuthor {
  const source = (raw ?? {}) as Record<string, unknown>;
  const username = str(source['username'], 'bilinmeyen');
  return {
    id: str(source['id']),
    username,
    // An empty display name would render as a blank row, so fall back to the handle.
    displayName: str(source['displayName']) || username,
    avatarUrl: optStr(source['avatarUrl']) ?? null,
    level: num(source['level'], 1),
  };
}

function normaliseDigestStats(raw: unknown): DigestStats | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  return {
    sessionCount: num(source['sessionCount']),
    totalMinutes: num(source['totalMinutes']),
    totalXp: num(source['totalXp']),
    topHabitName: optStr(source['topHabitName']),
  };
}

function normaliseSessionStats(raw: unknown): SessionStats | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  return {
    habitName: optStr(source['habitName']),
    durationMinutes: optNum(source['durationMinutes']) ?? optNum(source['minutes']),
    xp: optNum(source['xp']),
  };
}

const KNOWN_TYPES: readonly PostType[] = [
  'SESSION_COMPLETE',
  'DAILY_DIGEST',
  'LEVEL_UP',
  'ACHIEVEMENT',
  'CHALLENGE_RESULT',
  'TEXT',
  'IMAGE',
];

function normaliseType(raw: unknown): PostType {
  const value = str(raw);
  return KNOWN_TYPES.includes(value as PostType) ? (value as PostType) : 'TEXT';
}

export function normalisePost(raw: unknown): Post {
  const source = (raw ?? {}) as Record<string, unknown>;
  const media = Array.isArray(source['mediaUrls'])
    ? source['mediaUrls'].filter((url): url is string => typeof url === 'string')
    : [];

  return {
    id: str(source['id']),
    type: normaliseType(source['type']),
    content: str(source['content']),
    mediaUrls: media,
    likeCount: num(source['likeCount']),
    replyCount: num(source['replyCount']),
    createdAt: str(source['createdAt'], new Date().toISOString()),
    likedByMe: source['likedByMe'] === true,
    digestDate: optStr(source['digestDate']),
    digestStats: normaliseDigestStats(source['digestStats']),
    sessionStats: normaliseSessionStats(source['sessionStats']),
    level: optNum(source['level']),
    achievementName: optStr(source['achievementName']),
    author: normaliseAuthor(source['author']),
  };
}

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

export async function fetchFeed(input: {
  scope: FeedScope;
  cursor?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<FeedPage> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.cursor) params.set('cursor', input.cursor);

  const raw = await apiRequest<unknown>(`/v1/feed?${params.toString()}`, {
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const envelope = (raw ?? {}) as Record<string, unknown>;
  // The API names the page 'items'; 'posts' is accepted as a fallback so an older
  // build of either side keeps rendering instead of silently showing an empty feed.
  const page = Array.isArray(envelope['items'])
    ? envelope['items']
    : Array.isArray(envelope['posts'])
      ? envelope['posts']
      : [];
  const posts = page.map(normalisePost);
  const cursor = envelope['nextCursor'];

  return { posts, nextCursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null };
}

export async function createPost(input: { content: string }): Promise<Post> {
  const raw = await apiRequest<unknown>('/v1/posts', {
    method: 'POST',
    body: { type: 'TEXT', content: input.content },
  });
  const envelope = (raw ?? {}) as Record<string, unknown>;
  // Accept both `{ post }` and a bare post body — cheaper than coordinating on it.
  return normalisePost(envelope['post'] ?? envelope);
}

export function likePost(postId: string): Promise<void> {
  return apiRequest(`/v1/posts/${postId}/like`, { method: 'POST', body: {} });
}

export function unlikePost(postId: string): Promise<void> {
  return apiRequest(`/v1/posts/${postId}/like`, { method: 'DELETE' });
}

export function reportContent(input: {
  targetType: 'POST' | 'USER';
  targetId: string;
  reason: ReportReason;
  detail?: string | undefined;
}): Promise<void> {
  return apiRequest('/v1/reports', {
    method: 'POST',
    body: {
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ...(input.detail ? { detail: input.detail } : {}),
    },
  });
}

export function blockUser(username: string): Promise<void> {
  return apiRequest('/v1/blocks', { method: 'POST', body: { username } });
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/**
 * Turkish relative time.
 *
 * Intl.RelativeTimeFormat exists but Hermes ships without full ICU on Android, so a
 * hand-rolled formatter is the reliable option. Feed timestamps are short-range
 * anyway: past a week the absolute date reads better than "42 gün önce".
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = then.getTime();
  if (!Number.isFinite(ms)) return '';

  const diffSec = Math.floor((now.getTime() - ms) / 1000);
  if (diffSec < 45) return 'az önce';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} dk önce`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} sa önce`;

  const days = Math.floor(diffSec / 86_400);
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;
  if (days < 28) return `${Math.floor(days / 7)} hafta önce`;

  return then.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}
