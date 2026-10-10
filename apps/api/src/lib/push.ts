/**
 * Expo push delivery.
 *
 * Best-effort by nature: a reminder that fails to send is a missed nudge, not lost
 * data, so nothing here retries. What it must do is notice dead devices — Expo
 * reports an uninstalled app as DeviceNotRegistered, and a token that keeps being
 * sent to after that is how a project gets throttled.
 */

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { PrismaClient } from '@prisma/client';

/**
 * The slice of the Expo SDK used here, as a structural type so tests can inject a
 * stub instead of sending real notifications to real phones.
 */
export interface ExpoPushClient {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

export function createExpoClient(accessToken?: string): ExpoPushClient {
  return new Expo(accessToken ? { accessToken } : {});
}

export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
}

export interface PushResult {
  readonly sent: number;
  readonly failed: number;
  /** Tokens Expo reported as DeviceNotRegistered, now marked disabled. */
  readonly disabledTokens: readonly string[];
}

export async function sendPush(
  prisma: PrismaClient,
  expo: ExpoPushClient,
  messages: readonly PushMessage[],
  now: Date,
): Promise<PushResult> {
  const valid = messages.filter((message) => Expo.isExpoPushToken(message.token));
  const expoMessages: ExpoPushMessage[] = valid.map((message) => ({
    to: message.token,
    title: message.title,
    body: message.body,
    sound: 'default',
  }));

  let sent = 0;
  let failed = messages.length - valid.length;
  const disabledTokens: string[] = [];

  for (const chunk of expo.chunkPushNotifications(expoMessages)) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch {
      failed += chunk.length;
      continue;
    }
    // Tickets come back in the order the messages were sent.
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }
      failed += 1;
      const token = chunk[index]?.to;
      if (ticket.details?.error === 'DeviceNotRegistered' && typeof token === 'string') {
        disabledTokens.push(token);
      }
    });
  }

  if (disabledTokens.length > 0) {
    await prisma.pushToken.updateMany({
      where: { token: { in: disabledTokens } },
      data: { disabledAt: now },
    });
  }

  return { sent, failed, disabledTokens };
}
