/**
 * Push delivery.
 *
 * Expo is stubbed, which is the whole reason `PushService` takes an injectable
 * client: the three behaviours that actually matter here — the daily cap, retiring a
 * dead device token, and chunking — are all invisible from the outside and would
 * otherwise only ever be exercised against a real Expo project with real phones
 * attached. That is a synonym for untested.
 *
 * Fixtures are per-test and prefixed, and every assertion is scoped to this file's
 * own users. The database carries seed data; a global count of pushed notifications
 * would fail for reasons that have nothing to do with push.
 */

import { PrismaClient, type NotificationType } from '@prisma/client';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { DAILY_PUSH_LIMIT } from '../service.js';
import { PushService, isSubjectToDailyLimit, type ExpoPushClient } from '../push.js';

const prisma = new PrismaClient();
const PREFIX = 'test_push_';

/** Mutable so a test can cross a local-day boundary without waiting for one. */
let clock: Date;
function now(): Date {
  return clock;
}

/**
 * A stand-in for the Expo client.
 *
 * `chunkSize` is settable so a test can force several chunks out of a handful of
 * messages — the ticket-to-message alignment is per chunk, and an off-by-one there
 * would disable the wrong device token, which is a bug you cannot see from a count.
 */
class StubExpo implements ExpoPushClient {
  readonly chunks: ExpoPushMessage[][] = [];
  /** Decides each message's ticket. Default: everything is accepted. */
  ticketFor: (message: ExpoPushMessage) => ExpoPushTicket = () => ({
    status: 'ok',
    id: 'receipt-id',
  });

  readonly #chunkSize: number;

  constructor(chunkSize = 100) {
    this.#chunkSize = chunkSize;
  }

  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    const chunks: ExpoPushMessage[][] = [];
    for (let index = 0; index < messages.length; index += this.#chunkSize) {
      chunks.push(messages.slice(index, index + this.#chunkSize));
    }
    return chunks;
  }

  async sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    this.chunks.push(messages);
    return messages.map((message) => this.ticketFor(message));
  }

  /** Every message handed over, across every chunk. */
  get sent(): ExpoPushMessage[] {
    return this.chunks.flat();
  }
}

/** Uses the SDK's real splitter but never talks to the network. */
class RealChunkerExpo extends StubExpo {
  readonly #expo = new Expo({});

  override chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][] {
    return this.#expo.chunkPushNotifications(messages);
  }
}

let userId: string;
let expo: StubExpo;
let push: PushService;

async function makeUser(suffix: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      clerkId: `${PREFIX}${suffix}`,
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
      timezone: 'Europe/Istanbul',
    },
  });
  return user.id;
}

/** Registers a device. The bracket form is what `Expo.isExpoPushToken` accepts. */
async function addToken(owner: string, label: string): Promise<string> {
  const token = `ExponentPushToken[${PREFIX}${label}]`;
  await prisma.pushToken.create({
    data: { userId: owner, token, platform: 'IOS', deviceId: `${PREFIX}${label}` },
  });
  return token;
}

/** Creates unpushed notifications for `userId` and returns their ids, oldest first. */
async function queue(count: number, type: NotificationType = 'POST_LIKE'): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await prisma.notification.create({
      data: {
        userId,
        type,
        title: `${PREFIX}bildirim ${index}`,
        createdAt: new Date(clock.getTime() - (count - index) * 1000),
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  clock = new Date('2024-05-10T09:00:00.000Z');
  expo = new StubExpo();
  push = new PushService({ prisma, now, expo });

  userId = await makeUser('owner');
  await addToken(userId, 'device_a');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('the daily cap', () => {
  it('names the types it binds, and the ones it must never hold back', () => {
    // The social firehose: volume is driven by other people, and missing one costs
    // the user nothing because the inbox keeps it.
    expect(isSubjectToDailyLimit('POST_LIKE')).toBe(true);
    expect(isSubjectToDailyLimit('POST_COMMENT')).toBe(true);
    expect(isSubjectToDailyLimit('FRIEND_REQUEST')).toBe(true);
    expect(isSubjectToDailyLimit('CHALLENGE_INVITE')).toBe(true);
    expect(isSubjectToDailyLimit('LEVEL_UP')).toBe(true);

    // The exemptions, each for a stated reason — see push.ts.
    expect(isSubjectToDailyLimit('MODERATION_ACTION')).toBe(false);
    expect(isSubjectToDailyLimit('CHALLENGE_ENDED')).toBe(false);
    expect(isSubjectToDailyLimit('STREAK_AT_RISK')).toBe(false);
    expect(isSubjectToDailyLimit('SYSTEM')).toBe(false);
  });

  it(`delivers at most ${DAILY_PUSH_LIMIT} capped notifications a day`, async () => {
    const ids = await queue(5);

    const result = await push.deliver(ids);

    expect(result.delivered).toHaveLength(DAILY_PUSH_LIMIT);
    expect(result.skippedByDailyLimit).toHaveLength(5 - DAILY_PUSH_LIMIT);
    expect(expo.sent).toHaveLength(DAILY_PUSH_LIMIT);

    // Only what Expo actually took is marked pushed; that is what keeps tomorrow's
    // budget honest.
    const pushed = await prisma.notification.count({
      where: { userId, pushedAt: { not: null } },
    });
    expect(pushed).toBe(DAILY_PUSH_LIMIT);
  });

  it('spends the budget oldest first, so a conversation arrives in order', async () => {
    const ids = await queue(5);

    const result = await push.deliver(ids);

    expect(result.delivered).toEqual(ids.slice(0, DAILY_PUSH_LIMIT));
    expect(result.skippedByDailyLimit).toEqual(ids.slice(DAILY_PUSH_LIMIT));
  });

  it('remembers the budget across separate delivery runs on the same day', async () => {
    await push.deliver(await queue(DAILY_PUSH_LIMIT));
    expo.chunks.length = 0;

    const later = await push.deliver(await queue(2));

    expect(later.delivered).toHaveLength(0);
    expect(later.skippedByDailyLimit).toHaveLength(2);
    expect(expo.sent).toHaveLength(0);
  });

  /** The boundary is the USER's midnight, not the server's. */
  it('refills the budget on the next local day', async () => {
    await push.deliver(await queue(DAILY_PUSH_LIMIT));
    const held = await queue(2);

    clock = new Date('2024-05-11T09:00:00.000Z');
    const tomorrow = await push.deliver(held);

    expect(tomorrow.delivered).toHaveLength(2);
  });

  /**
   * The exemption that matters most. A suspension notice losing a race to three
   * likes is not a smaller version of the right behaviour.
   */
  it('delivers a moderation notice even after the cap is spent', async () => {
    await push.deliver(await queue(DAILY_PUSH_LIMIT));
    const notice = await queue(1, 'MODERATION_ACTION');

    const result = await push.deliver(notice);

    expect(result.delivered).toEqual(notice);
    expect(result.skippedByDailyLimit).toHaveLength(0);
  });

  /**
   * And it does not spend the budget either: a moderated user must not quietly lose
   * their ordinary notifications as a second, undecided punishment.
   */
  it('does not let exempt notifications consume the budget', async () => {
    await push.deliver(await queue(3, 'MODERATION_ACTION'));

    const result = await push.deliver(await queue(DAILY_PUSH_LIMIT));

    expect(result.delivered).toHaveLength(DAILY_PUSH_LIMIT);
    expect(result.skippedByDailyLimit).toHaveLength(0);
  });

  it('never pushes the same notification twice', async () => {
    const ids = await queue(1);
    await push.deliver(ids);
    expo.chunks.length = 0;

    const again = await push.deliver(ids);

    expect(again.delivered).toHaveLength(0);
    expect(expo.sent).toHaveLength(0);
  });
});

describe('device tokens', () => {
  /**
   * DeviceNotRegistered is about the token, not the message: the app was uninstalled
   * or the token rotated, and every future send to it fails the same way. The row is
   * DISABLED rather than deleted, because a deleted row cannot tell "never
   * registered" from "registered, then uninstalled" — and `registerPushToken` revives
   * it when the device comes back, which only works if it survived.
   */
  it('disables a token Expo reports as unregistered, without deleting it', async () => {
    const dead = await addToken(userId, 'device_dead');
    expo.ticketFor = (message): ExpoPushTicket =>
      message.to === dead
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'receipt-id' };

    const result = await push.deliver(await queue(1));

    expect(result.disabledTokens).toEqual([dead]);
    const row = await prisma.pushToken.findUniqueOrThrow({ where: { token: dead } });
    expect(row.disabledAt).toBeInstanceOf(Date);

    // The other device took it, so the notification is delivered, not retried.
    expect(result.delivered).toHaveLength(1);
  });

  it('stops addressing a disabled token on the next run', async () => {
    const dead = await addToken(userId, 'device_dead');
    expo.ticketFor = (message): ExpoPushTicket =>
      message.to === dead
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'receipt-id' };
    await push.deliver(await queue(1));
    expo.chunks.length = 0;
    expo.ticketFor = (): ExpoPushTicket => ({ status: 'ok', id: 'receipt-id' });

    await push.deliver(await queue(1));

    expect(expo.sent.map((message) => message.to)).not.toContain(dead);
  });

  it('reports a recipient with no device instead of counting it as a failure', async () => {
    const silent = await makeUser('nodevice');
    const row = await prisma.notification.create({
      data: { userId: silent, type: 'POST_LIKE', title: `${PREFIX}cihazsız`, createdAt: clock },
      select: { id: true },
    });

    const result = await push.deliver([row.id]);

    expect(result.skippedNoDevice).toEqual([row.id]);
    expect(result.failed).toHaveLength(0);
    // Left unpushed, so it becomes deliverable the moment a device registers.
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.pushedAt).toBeNull();
  });

  it('ignores a malformed token rather than letting it poison the batch', async () => {
    await prisma.pushToken.create({
      data: {
        userId,
        token: `${PREFIX}not-an-expo-token`,
        platform: 'ANDROID',
        deviceId: `${PREFIX}junk`,
      },
    });

    const result = await push.deliver(await queue(1));

    expect(result.delivered).toHaveLength(1);
    expect(expo.sent).toHaveLength(1);
  });
});

describe('chunking', () => {
  it('splits a large batch with the SDK’s own limit and delivers all of it', async () => {
    const chunker = new RealChunkerExpo();
    const service = new PushService({ prisma, now, expo: chunker });
    // Exempt type: the point of this test is the split, not the cap.
    const ids = await queue(120, 'SYSTEM');

    const result = await service.deliver(ids);

    expect(chunker.chunks.length).toBeGreaterThan(1);
    for (const chunk of chunker.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(Expo.pushNotificationChunkSizeLimit);
    }
    expect(result.delivered).toHaveLength(120);
  });

  /**
   * Tickets come back index-aligned with the messages of THEIR chunk. A ticket
   * matched to the wrong message would disable a healthy device and leave the dead
   * one in place — silent, and undetectable from any count.
   */
  it('matches each ticket to its own message across chunk boundaries', async () => {
    const tokenB = await addToken(userId, 'device_b');
    await addToken(userId, 'device_c');
    const chunked = new StubExpo(2);
    chunked.ticketFor = (message): ExpoPushTicket =>
      message.to === tokenB
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'receipt-id' };
    const service = new PushService({ prisma, now, expo: chunked });

    // One notification, three devices: three messages, split into chunks of two, so
    // the failing one is the first entry of the SECOND chunk.
    const result = await service.deliver(await queue(1));

    expect(chunked.chunks).toHaveLength(2);
    expect(result.disabledTokens).toEqual([tokenB]);
    const stillLive = await prisma.pushToken.count({ where: { userId, disabledAt: null } });
    expect(stillLive).toBe(2);
  });

  /** One bad chunk must not cost the rest of the batch its delivery. */
  it('keeps going when a chunk fails outright', async () => {
    const flaky = new StubExpo(1);
    let call = 0;
    const send = flaky.sendPushNotificationsAsync.bind(flaky);
    flaky.sendPushNotificationsAsync = async (messages): Promise<ExpoPushTicket[]> => {
      call += 1;
      if (call === 1) throw new Error('Expo is having a moment');
      return send(messages);
    };
    const service = new PushService({ prisma, now, expo: flaky });
    const ids = await queue(2, 'SYSTEM');

    const result = await service.deliver(ids);

    expect(result.delivered).toEqual([ids[1]]);
    // The one that never got a ticket stays unpushed, so the caller can retry it.
    expect(result.failed).toEqual([ids[0]]);
  });
});
