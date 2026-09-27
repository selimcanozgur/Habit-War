/**
 * Social endpoints: friends, friend requests, user search, duels, leaderboard, season.
 *
 * Types are declared here rather than imported from the API workspace on purpose:
 * the mobile app compiles against an agreed contract, not against another
 * workspace's internals. The backend is being written in parallel, so every field
 * the UI reads is treated as possibly absent and normalised once, at the bottom of
 * this file, instead of being guarded ad hoc inside JSX. A missing field must
 * degrade a row, never crash the screen.
 */

import type { Category, CharacterClass } from '@habitwar/domain';

import { apiRequest } from './client';

// ---------------------------------------------------------------------------
// Wire shapes — what the server is expected to send.
//
// Every property is optional because none of it is guaranteed yet. The `Safe*`
// types below are what the UI actually consumes.
// ---------------------------------------------------------------------------

export interface WireUser {
  readonly id?: string;
  readonly username?: string;
  readonly displayName?: string | null;
  readonly avatarUrl?: string | null;
  readonly level?: number;
  readonly classType?: CharacterClass | string | null;
}

/**
 * A friend row.
 *
 * `/v1/friends` sends the profile FLAT with `friendshipId` beside it, while
 * `/v1/friends/requests` nests the profile under `user`. Both are accepted: reading
 * only the nested form turned every friend into "Bilinmeyen kullanıcı · Seviye 1"
 * while the requests list above it rendered correctly — the kind of half-working
 * screen that reads as a data problem rather than a client one.
 */
export interface WireFriend extends WireUser {
  readonly friendshipId?: string;
  readonly user?: WireUser;
  readonly currentStreak?: number;
}

export interface WireFriendRequest {
  readonly friendshipId?: string;
  /** Some drafts of the contract call this `id`; both are accepted. */
  readonly id?: string;
  readonly user?: WireUser;
  readonly createdAt?: string;
}

export type ChallengeStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'DECLINED' | 'CANCELLED';

/**
 * A duel.
 *
 * The API carries each side's score INSIDE the participant (`challenger.xp`), not
 * as a sibling of it. Reading the sibling form scored every live duel 0-0, which
 * renders as "Berabere" — a wrong answer that looks like a legitimate one.
 */
export interface WireChallengeParticipant extends WireUser {
  readonly xp?: number;
}

export interface WireChallenge {
  readonly id?: string;
  readonly status?: ChallengeStatus | string;
  readonly category?: Category | string | null;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly challenger?: WireChallengeParticipant;
  readonly opponent?: WireChallengeParticipant;
  /** Sibling form, accepted as a fallback. */
  readonly challengerXp?: number;
  readonly opponentXp?: number;
}

/**
 * A leaderboard row.
 *
 * The API sends the profile fields FLAT alongside rank and weeklyXp, with the id
 * under `userId`. The nested `user` form is kept as an accepted alternative.
 */
export interface WireLeaderboardEntry extends WireUser {
  readonly rank?: number;
  readonly user?: WireUser;
  readonly weeklyXp?: number;
  /** Flat form of `user.id`. */
  readonly userId?: string;
  readonly isMe?: boolean;
}

export interface WireSeason {
  readonly id?: string;
  readonly name?: string;
  readonly theme?: string | null;
  readonly eventMultiplier?: number | null;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

// ---------------------------------------------------------------------------
// Normalised shapes — what the components render.
// ---------------------------------------------------------------------------

export interface SocialUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly level: number;
  readonly classType: CharacterClass | null;
}

export interface Friend {
  readonly friendshipId: string;
  readonly user: SocialUser;
  readonly currentStreak: number;
}

export interface FriendRequest {
  readonly friendshipId: string;
  readonly user: SocialUser;
}

export interface FriendRequests {
  readonly incoming: readonly FriendRequest[];
  readonly outgoing: readonly FriendRequest[];
}

export interface Challenge {
  readonly id: string;
  readonly status: ChallengeStatus;
  readonly category: Category | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly challenger: SocialUser;
  readonly opponent: SocialUser;
  readonly challengerXp: number;
  readonly opponentXp: number;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly user: SocialUser;
  readonly weeklyXp: number;
}

export interface Season {
  readonly id: string;
  readonly name: string;
  readonly theme: string | null;
  /** Null when the season runs at base rate; the banner then hides the multiplier. */
  readonly eventMultiplier: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function listFriends(): Promise<{ friends?: readonly WireFriend[] }> {
  return apiRequest('/v1/friends');
}

export function listFriendRequests(): Promise<{
  incoming?: readonly WireFriendRequest[];
  outgoing?: readonly WireFriendRequest[];
}> {
  return apiRequest('/v1/friends/requests');
}

export function sendFriendRequest(username: string): Promise<unknown> {
  return apiRequest('/v1/friends/request', { method: 'POST', body: { username } });
}

export function acceptFriendRequest(friendshipId: string): Promise<unknown> {
  return apiRequest(`/v1/friends/${friendshipId}/accept`, { method: 'POST', body: {} });
}

export function declineFriendRequest(friendshipId: string): Promise<unknown> {
  return apiRequest(`/v1/friends/${friendshipId}/decline`, { method: 'POST', body: {} });
}

/** Also the cancel path for an outgoing request: both sides are one Friendship row. */
export function removeFriend(friendshipId: string): Promise<unknown> {
  return apiRequest(`/v1/friends/${friendshipId}`, { method: 'DELETE' });
}

export function searchUsers(
  query: string,
  signal?: AbortSignal,
): Promise<{ users?: readonly WireUser[] }> {
  // Usernames may contain characters that are meaningful in a query string.
  return apiRequest(`/v1/users/search?q=${encodeURIComponent(query)}`, {
    ...(signal ? { signal } : {}),
  });
}

/**
 * The API splits duels into { active, past } rather than one list, because the two
 * render differently: active duels need a live score and a countdown, past ones a
 * result. Both are merged here and the screen filters by status.
 */
export function listChallenges(): Promise<{
  active?: readonly WireChallenge[];
  past?: readonly WireChallenge[];
  challenges?: readonly WireChallenge[];
}> {
  return apiRequest('/v1/challenges');
}

export function createChallenge(input: {
  opponentUsername: string;
  category: Category;
  days: number;
}): Promise<unknown> {
  return apiRequest('/v1/challenges', { method: 'POST', body: input });
}

export function acceptChallenge(challengeId: string): Promise<unknown> {
  return apiRequest(`/v1/challenges/${challengeId}/accept`, { method: 'POST', body: {} });
}

export function declineChallenge(challengeId: string): Promise<unknown> {
  return apiRequest(`/v1/challenges/${challengeId}/decline`, { method: 'POST', body: {} });
}

/** The API nests the board under 'leaderboard' alongside its week window. */
export function getFriendsLeaderboard(): Promise<{
  leaderboard?: { entries?: readonly WireLeaderboardEntry[] };
  entries?: readonly WireLeaderboardEntry[];
}> {
  return apiRequest('/v1/leaderboard/friends');
}

export function getCurrentSeason(): Promise<{ season?: WireSeason | null }> {
  return apiRequest('/v1/seasons/current');
}

// ---------------------------------------------------------------------------
// Defensive readers
// ---------------------------------------------------------------------------

const VALID_CLASSES: readonly string[] = [
  'SCHOLAR',
  'BERSERKER',
  'BARD',
  'MONK',
  'RANGER',
  'ARTISAN',
];

const VALID_CATEGORIES: readonly string[] = [
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'CREATIVE',
  'SOCIAL',
  'HEALTH',
  'SKILL',
];

const VALID_STATUSES: readonly string[] = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
];

/** Turkish category names. Kept beside the enum so a new category fails loudly here. */
export const categoryLabels: Readonly<Record<Category, string>> = {
  FITNESS: 'Spor',
  STUDY: 'Çalışma',
  MINDFULNESS: 'Farkındalık',
  CREATIVE: 'Yaratıcılık',
  SOCIAL: 'Sosyal',
  HEALTH: 'Sağlık',
  SKILL: 'Beceri',
};

export function describeCategory(category: Category | null | undefined): string {
  if (!category) return 'Tüm kategoriler';
  return categoryLabels[category] ?? category;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * A user row safe to render.
 *
 * `displayName` falls back to the username so a row never renders a blank name,
 * and an id-less record gets a synthetic key rather than colliding with others in
 * a list.
 */
export function normaliseUser(user: WireUser | undefined | null, index = 0): SocialUser {
  const username = nonEmpty(user?.username) ?? '';
  const rawClass = typeof user?.classType === 'string' ? user.classType : null;

  return {
    id: nonEmpty(user?.id) ?? (username !== '' ? `username:${username}` : `unknown:${index}`),
    username,
    displayName: nonEmpty(user?.displayName) ?? (username !== '' ? username : 'Bilinmeyen kullanıcı'),
    avatarUrl: nonEmpty(user?.avatarUrl),
    level: Math.max(1, Math.round(finiteOr(user?.level, 1))),
    classType: rawClass !== null && VALID_CLASSES.includes(rawClass)
      ? (rawClass as CharacterClass)
      : null,
  };
}

export function normaliseFriends(friends: readonly WireFriend[] | undefined | null): Friend[] {
  if (!Array.isArray(friends)) return [];
  return friends.map((friend, index) => ({
    friendshipId: nonEmpty(friend?.friendshipId) ?? `friendship:${index}`,
    user: normaliseUser(friend?.user ?? friend, index),
    currentStreak: Math.max(0, Math.round(finiteOr(friend?.currentStreak, 0))),
  }));
}

export function normaliseRequests(
  requests: readonly WireFriendRequest[] | undefined | null,
): FriendRequest[] {
  if (!Array.isArray(requests)) return [];
  return requests.map((request, index) => ({
    // Accepts either spelling of the id field so a contract drift does not strand
    // the accept/decline buttons without anything to post to.
    friendshipId: nonEmpty(request?.friendshipId) ?? nonEmpty(request?.id) ?? `request:${index}`,
    user: normaliseUser(request?.user, index),
  }));
}

export function normaliseChallenges(
  challenges: readonly WireChallenge[] | undefined | null,
): Challenge[] {
  if (!Array.isArray(challenges)) return [];
  return challenges.map((challenge, index) => {
    const rawStatus = typeof challenge?.status === 'string' ? challenge.status : '';
    const rawCategory = typeof challenge?.category === 'string' ? challenge.category : '';

    return {
      id: nonEmpty(challenge?.id) ?? `challenge:${index}`,
      status: VALID_STATUSES.includes(rawStatus) ? (rawStatus as ChallengeStatus) : 'PENDING',
      category: VALID_CATEGORIES.includes(rawCategory) ? (rawCategory as Category) : null,
      startsAt: nonEmpty(challenge?.startsAt),
      endsAt: nonEmpty(challenge?.endsAt),
      challenger: normaliseUser(challenge?.challenger, index),
      opponent: normaliseUser(challenge?.opponent, index + 1),
      // Nested first — that is what the API actually sends.
      challengerXp: Math.max(
        0,
        Math.round(finiteOr(challenge?.challenger?.xp ?? challenge?.challengerXp, 0)),
      ),
      opponentXp: Math.max(
        0,
        Math.round(finiteOr(challenge?.opponent?.xp ?? challenge?.opponentXp, 0)),
      ),
    };
  });
}

/**
 * Reads the friends leaderboard.
 *
 * The API returns each row FLAT — `{ rank, userId, username, displayName, level,
 * weeklyXp }` — not with the profile nested under `user`. Reading the nested shape
 * degraded every row to the placeholder profile, so the board rendered three
 * identical "Bilinmeyen kullanıcı · Seviye 1" entries against real accounts.
 * Both shapes are accepted so neither side can break the board by shipping first.
 */
export function normaliseLeaderboard(
  entries: readonly WireLeaderboardEntry[] | undefined | null,
): LeaderboardEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry, index) => ({
    // A server that omits `rank` still produces a sensible ladder from list order.
    rank: Math.max(1, Math.round(finiteOr(entry?.rank, index + 1))),
    // Flat rows keep the id under `userId`; normaliseUser reads `id`.
    user: normaliseUser(entry?.user ?? { ...entry, id: entry?.user?.id ?? entry?.userId }, index),
    weeklyXp: Math.max(0, Math.round(finiteOr(entry?.weeklyXp, 0))),
  }));
}

/**
 * A season, or null.
 *
 * The banner is hidden entirely when there is no season, so an unparseable payload
 * must resolve to null rather than to an empty-looking banner.
 */
export function normaliseSeason(season: WireSeason | undefined | null): Season | null {
  if (!season || typeof season !== 'object') return null;
  const name = nonEmpty(season.name);
  if (name === null) return null;

  const multiplier = finiteOr(season.eventMultiplier, 1);

  return {
    id: nonEmpty(season.id) ?? name,
    name,
    theme: nonEmpty(season.theme),
    // Only a genuine boost is worth screen space; 1× is the baseline, not an event.
    eventMultiplier: multiplier > 1 ? multiplier : null,
    startsAt: nonEmpty(season.startsAt),
    endsAt: nonEmpty(season.endsAt),
  };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Turkish "time left" phrasing. Coarse on purpose: a duel is measured in days. */
export function formatTimeRemaining(endsAt: string | null, now: number = Date.now()): string {
  if (endsAt === null) return 'Süre bilinmiyor';
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return 'Süre bilinmiyor';

  const ms = end - now;
  if (ms <= 0) return 'Süre doldu';

  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days} gün ${remainingHours} saat kaldı` : `${days} gün kaldı`;
  }
  if (hours >= 1) return `${hours} saat kaldı`;
  return `${Math.max(1, Math.floor(ms / 60_000))} dakika kaldı`;
}

/**
 * Elapsed fraction of a duel, 0..1.
 *
 * Returns 0 rather than throwing when either bound is missing, so a half-populated
 * challenge still renders a (stationary) time bar.
 */
export function challengeElapsedRatio(
  startsAt: string | null,
  endsAt: string | null,
  now: number = Date.now(),
): number {
  if (startsAt === null || endsAt === null) return 0;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}
