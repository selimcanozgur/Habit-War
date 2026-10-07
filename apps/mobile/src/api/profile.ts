/**
 * Profile endpoints.
 *
 * The profile tab reads from three independent endpoints (identity+stats, activity
 * summary, achievements) rather than one fat payload. That is deliberate: the stats
 * summary is period-scoped and refetches whenever the user flips week/month/all,
 * while the character card does not. Splitting them keeps a period switch from
 * re-rendering the whole screen.
 *
 * Types are declared here rather than imported from the API package because the
 * mobile app must compile against a contract, not against another workspace's
 * internals. Every field the UI reads is therefore treated as possibly absent:
 * the backend is being written in parallel, and a missing field must degrade the
 * screen, not crash it.
 */

import type { Category, CharacterClass, Stat, StatSheet } from '@habitwar/domain';

import { apiRequest } from './client';
import type { Habit } from './sessions';

/** Public-facing user record. */
export interface ProfileUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly level: number;
  /** XP inside the current prestige cycle. */
  readonly cycleXp: number;
  readonly prestige: number;
  readonly classType: CharacterClass | null;
  readonly timezone: string;
}

/** Mirrors `LevelProgress` from the domain engine — the XP bar reads this verbatim. */
export interface ProfileProgress {
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  readonly ratio: number;
  readonly isMaxLevel: boolean;
}

/**
 * What the API actually nests inside `user`.
 *
 * The agreed contract put `progress`, `stats` and `habits` at the top level of the
 * response. The implementation that shipped nests progression under
 * `user.progression`, the class under `user.characterClass.selected`, and the per-
 * habit streaks under `user.streaks.habits`. Both shapes are accepted rather than
 * betting on one: `readProfile` below flattens whichever arrived.
 */
export interface ServerOwnProfile extends Partial<ProfileUser> {
  /** ISO timestamp; null until the first-run flow is finished. */
  readonly onboardedAt?: string | null;
  /** Days in a row with a completed session, ending today or yesterday. */
  readonly dayStreak?: number;
  readonly progression?: Partial<ProfileProgress> & {
    readonly cycleXp?: number;
    readonly prestige?: number;
  };
  readonly characterClass?: { readonly selected?: CharacterClass | null };
  readonly stats?: Partial<StatSheet>;
  readonly statXp?: Partial<StatSheet>;
  readonly streaks?: {
    readonly longestCurrent?: number;
    readonly habits?: readonly { readonly lastCompletedDate?: string | null }[];
  };
}

export interface ProfileResponse {
  readonly user: ProfileUser & ServerOwnProfile;
  /** Present in the agreed contract; absent from the shipped API. */
  readonly progress?: Partial<ProfileProgress>;
  /** Displayed stat points, already derived server-side from `statXp`. */
  readonly stats?: Partial<StatSheet>;
  /** Raw accumulated stat XP. Kept for a future "progress to next point" affordance. */
  readonly statXp?: Partial<StatSheet>;
  readonly habits?: readonly Habit[];
}

/** One flat view of a profile, whichever of the two response shapes arrived. */
export interface NormalisedProfile {
  readonly user: ProfileUser;
  readonly progress: ProfileProgress;
  readonly stats: StatSheet;
  readonly statXp: StatSheet;
  /** The account's day streak: days in a row with a completed session. */
  readonly dayStreak: number;
  /** Local dates (YYYY-MM-DD) a habit was last completed — the streak grid's fallback. */
  readonly lastCompletedDates: readonly string[];
}

/**
 * Flattens a profile response into the single shape the screen renders.
 *
 * Every lookup checks the top level first and the nested `user.*` location second,
 * so the screen keeps working whichever way the endpoint settles.
 */
export function readProfile(response: ProfileResponse | undefined): NormalisedProfile | null {
  const user = response?.user;
  if (!user) return null;

  const progression = user.progression;
  const classType = user.classType ?? user.characterClass?.selected ?? null;

  const normalisedUser: ProfileUser = {
    id: user.id ?? '',
    username: user.username ?? '',
    displayName: user.displayName ?? null,
    bio: user.bio ?? null,
    avatarUrl: user.avatarUrl ?? null,
    level: user.level ?? progression?.level ?? 1,
    cycleXp: user.cycleXp ?? progression?.cycleXp ?? 0,
    prestige: user.prestige ?? progression?.prestige ?? 0,
    classType,
    timezone: user.timezone ?? 'Europe/Istanbul',
  };

  const habitDates = (response?.habits ?? [])
    .map((habit) => habit.lastCompletedDate)
    .concat((user.streaks?.habits ?? []).map((habit) => habit.lastCompletedDate ?? null))
    .filter((date): date is string => typeof date === 'string' && date.length > 0);

  return {
    user: normalisedUser,
    progress: normaliseProgress(response?.progress ?? progression, normalisedUser.level),
    stats: normaliseStatSheet(response?.stats ?? user.stats),
    statXp: normaliseStatSheet(response?.statXp ?? user.statXp),
    dayStreak: Math.max(0, finiteOr(user.dayStreak, 0)),
    lastCompletedDates: habitDates,
  };
}

/** Window the activity summary covers. */
export type StatsPeriod = 'week' | 'month' | 'all';

/** One day of the shipped API's `daily` series. */
export interface DailyPoint {
  readonly date?: string;
  readonly sessions?: number;
  readonly minutes?: number;
  readonly xp?: number;
}

/** One category bucket of the shipped API's `categories` array. */
export interface CategoryPoint {
  readonly category?: Category;
  readonly minutes?: number;
}

/**
 * The activity summary.
 *
 * The agreed contract said `byCategory` (an object) and `currentStreak`. The shipped
 * endpoint wraps everything in `{ stats: ... }`, replaces `byCategory` with a
 * `categories` array, carries no `currentStreak`, and adds a `daily` series. All of
 * it is optional here and reconciled by `readStats`.
 */
export interface ProfileStatsBody {
  readonly totalXp?: number;
  readonly sessionCount?: number;
  readonly totalMinutes?: number;
  readonly byCategory?: Partial<Record<Category, number>>;
  readonly categories?: readonly CategoryPoint[];
  readonly currentStreak?: number;
  readonly daily?: readonly DailyPoint[];
  /** ISO dates (YYYY-MM-DD) on which at least one session completed. */
  readonly activeDays?: readonly string[];
}

/** The endpoint returns the body either bare or wrapped in `{ stats }`. */
export type ProfileStatsResponse = ProfileStatsBody & { readonly stats?: ProfileStatsBody };

export interface NormalisedStats {
  readonly totalXp: number;
  readonly sessionCount: number;
  readonly totalMinutes: number;
  readonly byCategory: Partial<Record<Category, number>>;
  readonly currentStreak: number;
  /** Days with at least one completed session, derived from `daily` when needed. */
  readonly activeDays: readonly string[];
}

export function readStats(response: ProfileStatsResponse | undefined): NormalisedStats | null {
  if (!response) return null;
  const body = response.stats ?? response;

  const byCategory: Partial<Record<Category, number>> = { ...(body.byCategory ?? {}) };
  for (const bucket of body.categories ?? []) {
    // Zero-minute categories are dropped: the API zero-fills every category so the
    // axes stay stable, but a list of seven "0 dk" rows is noise in the UI.
    if (bucket.category && typeof bucket.minutes === 'number' && bucket.minutes > 0) {
      byCategory[bucket.category] = bucket.minutes;
    }
  }

  // The shipped API has no `currentStreak` on this endpoint, but its `daily` series
  // is enough to recover the active days the calendar actually needs.
  const activeDays =
    body.activeDays ??
    (body.daily ?? [])
      .filter((point) => (point.sessions ?? 0) > 0)
      .map((point) => point.date)
      .filter((date): date is string => typeof date === 'string' && date.length > 0);

  return {
    totalXp: body.totalXp ?? 0,
    sessionCount: body.sessionCount ?? 0,
    totalMinutes: body.totalMinutes ?? 0,
    byCategory,
    currentStreak: body.currentStreak ?? 0,
    activeDays,
  };
}

/** Achievement rarity, ascending. Drives the badge's accent colour. */
export type AchievementTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

/** What the shelf renders. Produced by `readAchievements`, never read raw. */
export interface Achievement {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly tier: AchievementTier | string;
  /** ISO timestamp, or null when the badge is still locked. */
  readonly earnedAt: string | null;
  /** Progress toward the threshold, when the API reports it. */
  readonly progress?: number;
  readonly threshold?: number;
}

/**
 * A badge as it arrives.
 *
 * The contract named `id`/`key`/`earnedAt`; the shipped API sends `code`,
 * `unlocked` and `unlockedAt`. Both are accepted — a badge shelf that silently shows
 * every badge as locked because it read the wrong field is worse than no shelf.
 */
export interface ServerAchievement {
  readonly id?: string;
  readonly key?: string;
  readonly code?: string;
  readonly name?: string;
  readonly description?: string;
  readonly category?: string;
  readonly tier?: AchievementTier | string;
  readonly earnedAt?: string | null;
  readonly unlockedAt?: string | null;
  readonly unlocked?: boolean;
  readonly progress?: number;
  readonly threshold?: number;
}

export interface AchievementsResponse {
  readonly achievements?: readonly ServerAchievement[];
  readonly unlockedCount?: number;
  readonly totalCount?: number;
}

export function readAchievements(
  response: AchievementsResponse | undefined,
): readonly Achievement[] {
  return (response?.achievements ?? []).map((entry, index): Achievement => {
    const identity = entry.id ?? entry.code ?? entry.key ?? `achievement-${index}`;
    // `unlocked` is authoritative when present; otherwise a timestamp implies it.
    const earnedAt = entry.earnedAt ?? entry.unlockedAt ?? null;
    return {
      id: identity,
      key: entry.key ?? entry.code ?? identity,
      name: entry.name ?? 'Rozet',
      description: entry.description ?? '',
      category: entry.category ?? '',
      tier: entry.tier ?? 'BRONZE',
      earnedAt: entry.unlocked === false ? null : earnedAt,
      ...(typeof entry.progress === 'number' ? { progress: entry.progress } : {}),
      ...(typeof entry.threshold === 'number' ? { threshold: entry.threshold } : {}),
    };
  });
}

/**
 * Fields the user may edit about themselves.
 *
 * Optional properties are `?: T | undefined` on purpose: under
 * `exactOptionalPropertyTypes` a caller building this object from form state needs
 * to be able to pass `undefined` for "leave alone".
 */
export interface UpdateProfileInput {
  readonly displayName?: string | undefined;
  readonly bio?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly timezone?: string | undefined;
  readonly classType?: CharacterClass | undefined;
}

export function getProfile(): Promise<ProfileResponse> {
  return apiRequest('/v1/users/me');
}

export function getProfileStats(period: StatsPeriod): Promise<ProfileStatsResponse> {
  return apiRequest(`/v1/users/me/stats?period=${period}`);
}

export function listAchievements(): Promise<AchievementsResponse> {
  return apiRequest('/v1/achievements');
}

export function updateProfile(input: UpdateProfileInput): Promise<{ user: ProfileUser }> {
  return apiRequest('/v1/users/me', { method: 'PATCH', body: input });
}

/** Marks the first-run flow finished; the app stops routing to it. */
export function completeOnboarding(): Promise<{ onboardedAt: string }> {
  return apiRequest('/v1/users/me/onboarding', { method: 'POST', body: {} });
}

/**
 * Whether the first-run flow still has to be shown. Only an explicit null says so: a
 * profile that failed to load, or a server that predates the field, lets the app open.
 */
export function needsOnboarding(response: ProfileResponse | undefined): boolean {
  return response?.user.onboardedAt === null;
}

// ---------------------------------------------------------------------------
// Defensive readers
//
// The screen renders before the backend is finished. Rather than scatter `??` and
// optional chaining through the JSX, every shape the UI depends on is normalised
// once, here, where the assumptions are visible and reviewable.
// ---------------------------------------------------------------------------

const ALL_STATS_ORDER: readonly Stat[] = ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX'];

/** Every stat present and numeric, whatever the server sent. */
export function normaliseStatSheet(sheet: Partial<StatSheet> | undefined | null): StatSheet {
  const safe: Record<Stat, number> = { STR: 0, END: 0, INT: 0, WIS: 0, CHA: 0, DEX: 0 };
  if (!sheet) return safe;
  for (const stat of ALL_STATS_ORDER) {
    const value = sheet[stat];
    if (typeof value === 'number' && Number.isFinite(value)) safe[stat] = Math.max(0, value);
  }
  return safe;
}

/**
 * A progress object safe to hand to `XpBar`.
 *
 * `ratio` is recomputed rather than trusted: a server that ships `ratio` as a
 * percentage, or omits it at max level, would otherwise produce a bar stuck at 100%
 * or animating off the end of its track.
 */
export function normaliseProgress(
  progress: Partial<ProfileProgress> | undefined | null,
  fallbackLevel: number,
): ProfileProgress {
  const level = finiteOr(progress?.level, fallbackLevel);
  const xpIntoLevel = Math.max(0, finiteOr(progress?.xpIntoLevel, 0));
  const xpForNextLevel = Math.max(0, finiteOr(progress?.xpForNextLevel, 0));
  const isMaxLevel = progress?.isMaxLevel === true || xpForNextLevel === 0;

  const ratio = isMaxLevel
    ? 1
    : clamp01(
        typeof progress?.ratio === 'number' && Number.isFinite(progress.ratio)
          ? progress.ratio
          : xpForNextLevel > 0
            ? xpIntoLevel / xpForNextLevel
            : 0,
      );

  return { level, xpIntoLevel, xpForNextLevel, ratio, isMaxLevel };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Turkish display names for the six classes. */
export const classLabels: Readonly<Record<CharacterClass, string>> = {
  SCHOLAR: 'Bilgin',
  BERSERKER: 'Cengâver',
  BARD: 'Ozan',
  MONK: 'Keşiş',
  RANGER: 'İzci',
  ARTISAN: 'Zanaatkâr',
};

/** Falls back to the raw key so an unexpected class still renders something. */
export function describeClass(classType: string | null | undefined): string {
  if (!classType) return 'Sınıf yok';
  return classLabels[classType as CharacterClass] ?? classType;
}
