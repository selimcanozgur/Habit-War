import { DAILY_GOAL_OPTIONS, MAX_BOOK_PAGES } from '@habitwar/domain';
import { z } from 'zod';

import { isValidTimeZone } from '../../jobs/time.js';

const dailyGoal = z
  .number()
  .int()
  .refine((goal) => DAILY_GOAL_OPTIONS.includes(goal), {
    message: `dailyGoal must be one of ${DAILY_GOAL_OPTIONS.join(', ')}`,
  });

/** Local wall-clock "HH:MM", 24-hour. Null turns the reminder off. */
const reminderTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'reminderTime must be HH:MM')
  .nullable();

const timezone = z.string().refine(isValidTimeZone, { message: 'Unknown timezone' });

const locale = z.enum(['TR', 'EN']);

export const updateMeBody = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    timezone: timezone.optional(),
    locale: locale.optional(),
    dailyGoal: dailyGoal.optional(),
    reminderTime: reminderTime.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

/** The first-run flow: goal, reminder, language, and optionally the first book. */
export const onboardingBody = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  timezone,
  locale,
  dailyGoal,
  reminderTime,
  firstBook: z
    .object({
      title: z.string().trim().min(1).max(200),
      author: z.string().trim().max(200).nullish(),
      pageCount: z.number().int().min(1).max(MAX_BOOK_PAGES),
    })
    .optional(),
});

export const pushTokenBody = z.object({
  token: z.string().min(1).max(200),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
});

export const pushTokenParams = z.object({ token: z.string().min(1) });

export type UpdateMeInput = z.infer<typeof updateMeBody>;
export type OnboardingInput = z.infer<typeof onboardingBody>;
