/**
 * Habit and session endpoints.
 *
 * Every mutating call carries a `clientRequestId`. The API is idempotent on it, so a
 * retry after a dropped response converges instead of awarding XP twice — which is
 * the whole reason the field exists.
 */

import type { Category, Stat, Verification } from '@habitwar/domain';

import type { StorySessionResult } from './story';
import { apiRequest } from './client';

export interface Habit {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly stat: Stat | null;
  readonly targetMinutes: number;
  readonly colorHex: string;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastCompletedDate: string | null;
  /** TIMED: the timer. COUNT: quick taps toward `targetCount`. */
  readonly kind?: 'TIMED' | 'COUNT';
  readonly targetCount?: number | null;
  readonly unit?: string | null;
  /** COUNT only: logged so far today. */
  readonly todayCount?: number;
}

export interface Session {
  readonly id: string;
  readonly habitId: string;
  /** ISO timestamp. The client derives elapsed time from this, never from its own counter. */
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED' | 'INVALIDATED';
  /** ISO timestamp while paused. */
  readonly pausedAt?: string | null;
  /** Seconds of pauses already resumed. */
  readonly pausedSec?: number;
  /** Pauses taken; each costs the uninterrupted bonus. */
  readonly pauseCount?: number;
}

export interface CompleteSessionResponse {
  readonly session: Session;
  readonly xp: number;
  readonly statXp: number;
  readonly statPointsGained: number;
  readonly stat: Stat;
  readonly hitDailyCap: boolean;
  readonly leveledUp: boolean;
  readonly level: number;
  readonly xpIntoLevel: number;
  readonly xpForNextLevel: number;
  readonly streak: number;
  readonly suggestedClass: string | null;
  readonly replayed: boolean;
  /** What the session did to the story; null on a replay. */
  readonly story?: StorySessionResult | null;
}

export function listHabits(): Promise<{ habits: Habit[] }> {
  return apiRequest('/v1/habits');
}

/**
 * Creates a habit. The server picks the stat from the category, so the client only
 * sends what the user chose.
 */
export function createHabit(input: {
  name: string;
  category: Category;
  targetMinutes: number;
  kind?: 'TIMED' | 'COUNT';
  targetCount?: number;
  unit?: string;
}): Promise<{ habit: Habit }> {
  return apiRequest('/v1/habits', { method: 'POST', body: input });
}

/**
 * Logs a count habit — "+10 şınav". Scored on the server as the session it is worth,
 * so the response is a completion: XP, streak, and the hit on the hunted monster.
 */
export function logCount(
  habitId: string,
  input: { count: number; clientRequestId: string },
): Promise<CompleteSessionResponse> {
  return apiRequest(`/v1/habits/${habitId}/log`, { method: 'POST', body: input });
}

/**
 * Removes a habit from the list. The server archives rather than destroys it, so the
 * sessions and XP it earned stay in the user's history.
 */
export function deleteHabit(habitId: string): Promise<{ habit: Habit }> {
  return apiRequest(`/v1/habits/${habitId}`, { method: 'DELETE' });
}

export function getActiveSession(): Promise<{ session: Session | null }> {
  return apiRequest('/v1/sessions/active');
}

export function startSession(input: {
  habitId: string;
  clientRequestId: string;
}): Promise<{ session: Session }> {
  return apiRequest('/v1/sessions/start', { method: 'POST', body: input });
}

export function completeSession(
  sessionId: string,
  input: {
    clientRequestId: string;
    interruptions: number;
    verification?: Verification;
  },
): Promise<CompleteSessionResponse> {
  return apiRequest(`/v1/sessions/${sessionId}/complete`, { method: 'POST', body: input });
}

/** Pauses the running session. The pause is not credited and counts as an interruption. */
export function pauseSession(sessionId: string): Promise<{ session: Session }> {
  return apiRequest(`/v1/sessions/${sessionId}/pause`, { method: 'POST', body: {} });
}

export function resumeSession(sessionId: string): Promise<{ session: Session }> {
  return apiRequest(`/v1/sessions/${sessionId}/resume`, { method: 'POST', body: {} });
}

export function abandonSession(sessionId: string): Promise<{ session: Session }> {
  return apiRequest(`/v1/sessions/${sessionId}/abandon`, { method: 'POST', body: {} });
}
