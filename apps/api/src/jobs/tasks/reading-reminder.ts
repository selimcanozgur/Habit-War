/**
 * The daily reading reminder, sent at the time each reader chose.
 *
 * The cron is UTC and frequent (READING_REMINDER_CRON); whether a reminder is due is
 * decided per user, on their own wall clock, so "21:00" means 21:00 wherever they
 * are. A reader who has already read today gets nothing — the reminder exists to
 * prompt reading, not to congratulate it.
 *
 * AT MOST ONCE PER DAY. Before sending, each due user is claimed by writing today's
 * local date to `lastRemindedDate` with a conditional update. A retry, an overlapping
 * run or the wide REMINDER_WINDOW_MINUTES cannot claim the same user twice, so
 * nobody is reminded twice. The price is that a failed send is not retried that day,
 * which is the right trade for a nudge.
 */

import { localDateKey } from '@habitwar/domain';
import type { Locale } from '@prisma/client';

import { sendPush, type ExpoPushClient, type PushMessage } from '../../lib/push.js';
import { REMINDER_WINDOW_MINUTES } from '../constants.js';
import type { JobContext, JobOutcome, JobTask } from '../context.js';
import { isValidTimeZone, localMinutes } from '../time.js';

export interface ReadingReminderResult extends JobOutcome {
  /** Users reminded on this run. */
  readonly processed: number;
  readonly sent: number;
  readonly failed: number;
  /** Users skipped because their stored timezone is not a real one. */
  readonly invalidTimezones: number;
}

/** "HH:MM" as minutes since midnight. */
function parseReminderTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Whether a reminder set for `reminderTime` is due at `nowMinutes` local time.
 * The window does not wrap past midnight: by then it is a different day, and that
 * day's reminder is still ahead.
 */
export function isReminderDue(
  reminderTime: string,
  nowMinutes: number,
  windowMinutes: number = REMINDER_WINDOW_MINUTES,
): boolean {
  const at = parseReminderTime(reminderTime);
  if (at === null) return false;
  const since = nowMinutes - at;
  return since >= 0 && since < windowMinutes;
}

export function reminderCopy(locale: Locale, dailyGoal: number): { title: string; body: string } {
  return locale === 'EN'
    ? { title: 'Time to read', body: `Your ${dailyGoal} pages for today are waiting.` }
    : { title: 'Okuma vakti', body: `Bugünkü ${dailyGoal} sayfan seni bekliyor.` };
}

export function createReadingReminderTask(expo: ExpoPushClient): JobTask {
  return (context) => runReadingReminder(context, expo);
}

export async function runReadingReminder(
  context: JobContext,
  expo: ExpoPushClient,
): Promise<ReadingReminderResult> {
  const { prisma, now, logger } = context;

  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      onboardedAt: { not: null },
      reminderTime: { not: null },
      pushTokens: { some: { disabledAt: null } },
    },
    select: {
      id: true,
      timezone: true,
      locale: true,
      dailyGoal: true,
      reminderTime: true,
      lastRemindedDate: true,
      lastReadDate: true,
      pushTokens: { where: { disabledAt: null }, select: { token: true } },
    },
  });

  let invalidTimezones = 0;
  const messages: PushMessage[] = [];
  let processed = 0;

  for (const user of candidates) {
    if (!isValidTimeZone(user.timezone)) {
      invalidTimezones += 1;
      continue;
    }
    const today = localDateKey(now, user.timezone);
    if (user.lastReadDate === today || user.lastRemindedDate === today) continue;
    if (!isReminderDue(user.reminderTime as string, localMinutes(now, user.timezone))) continue;

    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ lastRemindedDate: null }, { lastRemindedDate: { not: today } }],
      },
      data: { lastRemindedDate: today },
    });
    if (claimed.count === 0) continue;

    processed += 1;
    const copy = reminderCopy(user.locale, user.dailyGoal);
    for (const { token } of user.pushTokens) messages.push({ token, ...copy });
  }

  const result = messages.length > 0 ? await sendPush(prisma, expo, messages, now) : null;
  const outcome: ReadingReminderResult = {
    processed,
    sent: result?.sent ?? 0,
    failed: result?.failed ?? 0,
    invalidTimezones,
  };

  logger.info({ ...outcome, disabledTokens: result?.disabledTokens.length ?? 0 }, 'reading reminders sent');
  return outcome;
}
