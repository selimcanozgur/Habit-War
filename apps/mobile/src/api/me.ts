/** The signed-in user's own profile and settings. */

import type { LevelProgress } from '@habitwar/domain';

import type { ServerLocale } from '../i18n';
import { apiRequest } from './client';
import type { BookInput } from './reading';

export interface Profile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly timezone: string;
  readonly locale: ServerLocale;
  readonly onboarded: boolean;
  readonly dailyGoal: number;
  readonly reminderTime: string | null;
  readonly xp: number;
  readonly progress: LevelProgress;
  readonly streak: { readonly current: number; readonly longest: number };
  readonly stats: {
    readonly totalPages: number;
    readonly booksFinished: number;
    readonly daysRead: number;
    readonly windowDays: number;
  };
  readonly createdAt: string;
}

export interface ProfileUpdate {
  readonly displayName?: string;
  readonly timezone?: string;
  readonly locale?: ServerLocale;
  readonly dailyGoal?: number;
  readonly reminderTime?: string | null;
}

export interface OnboardingInput {
  readonly timezone: string;
  readonly locale: ServerLocale;
  readonly dailyGoal: number;
  readonly reminderTime: string | null;
  readonly firstBook?: BookInput;
}

export const PROFILE_KEY = ['profile'] as const;

export async function getProfile(): Promise<Profile> {
  return (await apiRequest<{ profile: Profile }>('/v1/me')).profile;
}

export async function updateProfile(update: ProfileUpdate): Promise<Profile> {
  return (await apiRequest<{ profile: Profile }>('/v1/me', { method: 'PATCH', body: update })).profile;
}

export async function completeOnboarding(input: OnboardingInput): Promise<Profile> {
  return (
    await apiRequest<{ profile: Profile }>('/v1/me/onboarding', { method: 'POST', body: input })
  ).profile;
}

export function registerPushToken(token: string, platform: 'IOS' | 'ANDROID' | 'WEB'): Promise<void> {
  return apiRequest<void>('/v1/me/push-tokens', { method: 'POST', body: { token, platform } });
}

export function deleteAccount(): Promise<void> {
  return apiRequest<void>('/v1/me', { method: 'DELETE' });
}

/** The device's IANA timezone, so "today" and the reminder follow the user's clock. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
}
