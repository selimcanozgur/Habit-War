/**
 * Habit and session endpoints.
 *
 * Every mutating call carries a `clientRequestId`. The API is idempotent on it, so a
 * retry after a dropped response converges instead of awarding XP twice — which is
 * the whole reason the field exists.
 */

import type { Category, Stat, Verification } from '@habitwar/domain';

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
}

export interface Session {
  readonly id: string;
  readonly habitId: string;
  /** ISO timestamp. The client derives elapsed time from this, never from its own counter. */
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED' | 'INVALIDATED';
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
}

export function listHabits(): Promise<{ habits: Habit[] }> {
  return apiRequest('/v1/habits');
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

export function abandonSession(sessionId: string): Promise<{ session: Session }> {
  return apiRequest(`/v1/sessions/${sessionId}/abandon`, { method: 'POST', body: {} });
}
