/**
 * Reading reminders, run as a plain function against Postgres with a stub Expo
 * client — no Redis, no real phones.
 */

import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ExpoPushClient } from '../../lib/push.js';
import type { JobContext } from '../context.js';
import { createLogger } from '../logger.js';
import { isReminderDue, reminderCopy, runReadingReminder } from '../tasks/reading-reminder.js';

const prisma = new PrismaClient();
const PREFIX = 'test_job_remind_';

/** 21:05 in Istanbul (UTC+3). */
const NOW = new Date('2026-10-10T18:05:00.000Z');
const TODAY = '2026-10-10';

function context(now: Date = NOW): JobContext {
  return { prisma, now, logger: createLogger({ level: 'fatal', name: 'test', write: () => {} }) };
}

/** Records what would have been sent; reports chosen tokens as uninstalled. */
function stubExpo(deadTokens: readonly string[] = []) {
  const sent: ExpoPushMessage[] = [];
  const client: ExpoPushClient = {
    chunkPushNotifications: (messages) => [messages],
    sendPushNotificationsAsync: async (messages) => {
      sent.push(...messages);
      return messages.map((message): ExpoPushTicket =>
        deadTokens.includes(message.to as string)
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 'ticket' },
      );
    },
  };
  return { client, sent };
}

let counter = 0;
async function makeReader(overrides: {
  reminderTime?: string | null;
  lastReadDate?: string | null;
  locale?: 'TR' | 'EN';
}) {
  counter += 1;
  const token = `ExponentPushToken[${PREFIX}${counter}]`;
  const user = await prisma.user.create({
    data: {
      username: `${PREFIX}${counter}`,
      displayName: 'Okur',
      email: `${PREFIX}${counter}@example.com`,
      timezone: 'Europe/Istanbul',
      onboardedAt: new Date('2026-01-01T00:00:00Z'),
      reminderTime: overrides.reminderTime === undefined ? '21:00' : overrides.reminderTime,
      lastReadDate: overrides.lastReadDate ?? null,
      locale: overrides.locale ?? 'TR',
      pushTokens: { create: { token, platform: 'IOS' } },
    },
  });
  return { id: user.id, token };
}

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe('isReminderDue', () => {
  it('is due from the chosen minute until the window closes', () => {
    expect(isReminderDue('21:00', 21 * 60 - 1, 60)).toBe(false);
    expect(isReminderDue('21:00', 21 * 60, 60)).toBe(true);
    expect(isReminderDue('21:00', 21 * 60 + 59, 60)).toBe(true);
    expect(isReminderDue('21:00', 22 * 60, 60)).toBe(false);
  });

  it('does not wrap past midnight', () => {
    expect(isReminderDue('23:30', 10, 60)).toBe(false);
  });

  it('ignores a malformed time', () => {
    expect(isReminderDue('9pm', 21 * 60, 60)).toBe(false);
  });
});

describe('reminderCopy', () => {
  it('speaks the user\'s language', () => {
    expect(reminderCopy('EN', 10).title).toBe('Time to read');
    expect(reminderCopy('TR', 10).body).toContain('10 sayfan');
  });
});

describe('runReadingReminder', () => {
  it('reminds a reader whose time has come and who has not read today', async () => {
    const reader = await makeReader({});
    const expo = stubExpo();

    await runReadingReminder(context(), expo.client);

    expect(expo.sent.map((message) => message.to)).toContain(reader.token);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: reader.id } });
    expect(user.lastRemindedDate).toBe(TODAY);
  });

  it('never reminds the same reader twice in a day', async () => {
    const reader = await makeReader({});
    const expo = stubExpo();

    await runReadingReminder(context(), expo.client);
    await runReadingReminder(context(new Date(NOW.getTime() + 15 * 60_000)), expo.client);

    expect(expo.sent.filter((message) => message.to === reader.token)).toHaveLength(1);
  });

  it('skips a reader who already read today', async () => {
    const reader = await makeReader({ lastReadDate: TODAY });
    const expo = stubExpo();

    await runReadingReminder(context(), expo.client);
    expect(expo.sent.map((message) => message.to)).not.toContain(reader.token);
  });

  it('skips a reader whose time has not come, or who turned reminders off', async () => {
    const later = await makeReader({ reminderTime: '22:00' });
    const off = await makeReader({ reminderTime: null });
    const expo = stubExpo();

    await runReadingReminder(context(), expo.client);
    const recipients = expo.sent.map((message) => message.to);
    expect(recipients).not.toContain(later.token);
    expect(recipients).not.toContain(off.token);
  });

  it('disables a token Expo reports as uninstalled', async () => {
    const reader = await makeReader({});
    const expo = stubExpo([`ExponentPushToken[${PREFIX}${counter}]`]);

    await runReadingReminder(context(), expo.client);
    const token = await prisma.pushToken.findUniqueOrThrow({ where: { token: reader.token } });
    expect(token.disabledAt).not.toBeNull();
  });
});
