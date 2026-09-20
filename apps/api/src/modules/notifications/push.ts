/**
 * Push delivery.
 *
 * The other half of `service.ts`: that file owns the inbox, which is the record; this
 * one owns delivery, which is best-effort. Nothing here may ever be able to fail a
 * like, a duel or a suspension — by the time a row reaches this module the action it
 * describes has already committed.
 *
 * WHAT THIS FILE IS NOT. There is no queue, no worker, no retry policy and no
 * scheduler here. `deliver` is the function such a worker calls; deciding when to
 * call it, how often, and what to do with a notification it could not deliver belongs
 * to `src/jobs/`. The split matters because delivery has to be callable
 * synchronously from a test and from a one-off script, not only from a running queue.
 */

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { NotificationType, PrismaClient } from '@prisma/client';
import { localDateKey } from '@habitwar/domain';

import { DAILY_PUSH_LIMIT } from './service.js';

/** Injectable clock, matching the convention across the other services. */
export type Clock = () => Date;

/**
 * The slice of the Expo SDK this module uses.
 *
 * Declared as a structural type and injected rather than newed up inside `deliver`,
 * for the same reason `plugins/auth.ts` injects `verifyTokenFn`: otherwise the only
 * way to exercise chunking, ticket handling or the DeviceNotRegistered path is to own
 * an Expo account and send real notifications to real phones — which means these
 * paths get tested in production or not at all. A stub satisfies this interface in
 * about ten lines.
 */
export interface ExpoPushClient {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

export interface PushServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /** Overrides the Expo client. Tests inject a stub; production leaves it out. */
  readonly expo?: ExpoPushClient | undefined;
  /** Expo access token, when the project has enhanced security enabled. */
  readonly accessToken?: string | undefined;
}

/**
 * What one `deliver` call did.
 *
 * Ids rather than counts for everything the caller may need to act on: a worker has
 * to know WHICH notifications it still owes, and a number cannot tell it that.
 */
export interface PushDeliveryResult {
  /** Handed to Expo with at least one accepted ticket. `pushedAt` is now set. */
  readonly delivered: readonly string[];
  /** Held back by the daily cap. Still unpushed; see the note on the cap below. */
  readonly skippedByDailyLimit: readonly string[];
  /** The recipient has no live device token. Still unpushed. */
  readonly skippedNoDevice: readonly string[];
  /** Attempted, every ticket errored. Still unpushed, so a retry is the caller's call. */
  readonly failed: readonly string[];
  /** Tokens Expo reported as DeviceNotRegistered, now marked `disabledAt`. */
  readonly disabledTokens: readonly string[];
}

/**
 * How far back to look when counting today's deliveries.
 *
 * 48 hours covers the widest real timezone span (UTC-12 to UTC+14) with room to
 * spare, so the user's local day is always fully inside the window no matter where
 * they are. Bounding the scan is what keeps the count from degenerating into a read
 * of the user's entire notification history as the table grows.
 */
const LOCAL_DAY_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/** Matches `User.timezone`'s schema default; used only when a stored value is junk. */
const FALLBACK_TIMEZONE = 'Europe/Istanbul';

/**
 * Notification types the three-per-day cap binds, as the complement of the exempt
 * list — so a type added to the schema is capped by default. Getting that default
 * backwards would mean a new notification type silently bypassing the cap, which is
 * how a 3/day promise quietly becomes a 9/day product.
 *
 * THE RULE: a type is EXEMPT when the notification is about the reader's own standing
 * or is worthless if withheld, AND its volume is structurally bounded. Everything
 * else — anything whose volume is driven by other people doing things — is capped,
 * because missing one of those costs the user nothing: it is still in the inbox, and
 * the inbox is the record.
 *
 * Applying that rule:
 *
 *  - MODERATION_ACTION is exempt, and this is the one that matters most. A suspension
 *    notice losing a race to three likes is not a smaller version of the right
 *    behaviour — it is an account that stops working for reasons the person cannot
 *    see or date, which is precisely the harm the DSA's statement-of-reasons duty
 *    exists to prevent. `modules/moderation/service.ts` writes these inside the
 *    enforcement transaction so the record cannot go missing; suppressing the push
 *    would undo that at the last step. Volume is bounded by moderator effort, and a
 *    user receiving three of these in one day has bigger problems than notification
 *    fatigue.
 *  - CHALLENGE_ENDED is exempt. At most one per duel, for a duel the user explicitly
 *    accepted and which ran 3-7 days; it is the payoff of something they opted into,
 *    and a duel that never visibly ends is a loose thread the product cannot tie off
 *    later. (CHALLENGE_INVITE and CHALLENGE_ACCEPTED are NOT exempt — those are
 *    other-driven and an invitation can wait.)
 *  - STREAK_AT_RISK is exempt. Its entire value is that it arrives before midnight;
 *    delivered late it is not a degraded notification, it is a taunt about a streak
 *    the user has already lost. It is also self-limiting — at most one per day by
 *    construction.
 *  - SYSTEM is exempt. It has no automatic producer: it is for account and service
 *    notices, so it cannot be used for volume, and rationing it would mean rationing
 *    security messages behind badge unlocks.
 *
 * Everything else is capped, including the self-inflicted ones: ACHIEVEMENT_UNLOCKED
 * and LEVEL_UP are pure celebration, and one good evening can produce five of them.
 */
const CAP_EXEMPT: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'MODERATION_ACTION',
  'CHALLENGE_ENDED',
  'STREAK_AT_RISK',
  'SYSTEM',
]);

/**
 * Whether `DAILY_PUSH_LIMIT` binds this type.
 *
 * Exported because the cap is a product promise (the spec's own risk table) and the
 * one place it is written down should be assertable from a test, not re-derived.
 */
export function isSubjectToDailyLimit(type: NotificationType): boolean {
  return !CAP_EXEMPT.has(type);
}

/** A notification paired with one of its recipient's live tokens. */
interface Addressed {
  readonly notificationId: string;
  readonly token: string;
}

export class PushService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;
  readonly #expo: ExpoPushClient;

  constructor({ prisma, now, expo, accessToken }: PushServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    // Constructing the real client does no I/O, so this is safe to do eagerly; it is
    // only ever reached when nothing was injected.
    this.#expo = expo ?? new Expo(accessToken === undefined ? {} : { accessToken });
  }

  /**
   * Delivers the given notifications, newest-created last.
   *
   * Takes ids rather than rows so the caller cannot hand over a stale copy of a row
   * that has since been pushed — the `pushedAt: null` filter below is the guard
   * against double delivery, and it only works if this function does the read.
   *
   * ORDER IS CREATION ORDER, oldest first, and that is what the cap spends its budget
   * in. "X arkadaşlık isteğini kabul etti" arriving before "X seni düelloya davet
   * etti" is the only sequence that reads correctly; spending the budget on the
   * newest three would deliver a conversation backwards.
   */
  async deliver(notificationIds: readonly string[]): Promise<PushDeliveryResult> {
    if (notificationIds.length === 0) return emptyResult();

    const rows = await this.#prisma.notification.findMany({
      where: { id: { in: [...notificationIds] }, pushedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        body: true,
        targetType: true,
        targetId: true,
        user: { select: { timezone: true } },
      },
    });
    if (rows.length === 0) return emptyResult();

    // Grouped per user because the cap is per user, and because one query for the
    // whole batch's tokens beats one per notification.
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byUser.get(row.userId);
      if (bucket) bucket.push(row);
      else byUser.set(row.userId, [row]);
    }

    const skippedByDailyLimit: string[] = [];
    const allowed: typeof rows = [];

    for (const [userId, userRows] of byUser) {
      const timezone = userRows[0]?.user.timezone ?? FALLBACK_TIMEZONE;
      let budget = await this.#remainingDailyBudget(userId, timezone);

      for (const row of userRows) {
        if (!isSubjectToDailyLimit(row.type)) {
          // Exempt rows neither consume the budget nor are blocked by it. Letting
          // them consume it would mean a moderated user silently losing their
          // ordinary notifications as a side effect of being moderated — a second,
          // undocumented punishment nobody decided to impose.
          allowed.push(row);
          continue;
        }
        if (budget <= 0) {
          skippedByDailyLimit.push(row.id);
          continue;
        }
        budget -= 1;
        allowed.push(row);
      }
    }

    if (allowed.length === 0) {
      return { ...emptyResult(), skippedByDailyLimit };
    }

    const tokensByUser = await this.#liveTokensByUser([...new Set(allowed.map((r) => r.userId))]);

    const messages: ExpoPushMessage[] = [];
    const addressed: Addressed[] = [];
    const skippedNoDevice: string[] = [];

    for (const row of allowed) {
      const tokens = tokensByUser.get(row.userId) ?? [];
      if (tokens.length === 0) {
        // Not a failure: most accounts have no device registered, and a user who
        // never installed the app is not owed a push. The row stays unpushed so it
        // becomes deliverable the moment they register a token.
        skippedNoDevice.push(row.id);
        continue;
      }

      for (const token of tokens) {
        messages.push({
          to: token,
          title: row.title,
          ...(row.body === null ? {} : { body: row.body }),
          sound: 'default',
          // The deep-link target, carried as data so the app can route the tap
          // without a round trip. `notificationId` lets the client mark it read.
          data: {
            notificationId: row.id,
            type: row.type,
            targetType: row.targetType,
            targetId: row.targetId,
          },
        });
        addressed.push({ notificationId: row.id, token });
      }
    }

    if (messages.length === 0) {
      return { ...emptyResult(), skippedByDailyLimit, skippedNoDevice };
    }

    const { accepted, deadTokens } = await this.#send(messages, addressed);

    const disabledTokens = await this.#disableTokens(deadTokens);

    // A notification counts as delivered when at least ONE of its devices accepted
    // it. A user with a live phone and a stale tablet has been reached; holding the
    // row back for the tablet would push the same thing to the phone again tomorrow.
    const delivered = allowed.filter((row) => accepted.has(row.id)).map((row) => row.id);
    const failed = allowed
      .filter((row) => !accepted.has(row.id) && !skippedNoDevice.includes(row.id))
      .map((row) => row.id);

    if (delivered.length > 0) {
      // `pushedAt` is set only for rows Expo accepted, which is what keeps the daily
      // budget honest: the count below is a count of pushes that actually happened.
      await this.#prisma.notification.updateMany({
        where: { id: { in: delivered } },
        data: { pushedAt: this.#now() },
      });
    }

    return { delivered, skippedByDailyLimit, skippedNoDevice, failed, disabledTokens };
  }

  /**
   * How many capped pushes this user may still receive today, in THEIR timezone.
   *
   * The day boundary is local for the same reason streaks and daily caps are local:
   * a UTC day would give a user in Istanbul a fresh allowance at 03:00 and cut the
   * evening short. Rather than converting a local date key back into a UTC instant
   * range — offset arithmetic that DST makes wrong twice a year — this reads a
   * bounded window of recent pushes and compares date keys with the same
   * `localDateKey` helper the rest of the system uses.
   *
   * `createdAt` is constrained as well as `pushedAt`: a notification can never be
   * pushed before it was created, so the extra predicate is free and it lets the
   * query seek on `@@index([userId, createdAt(sort: Desc)])` instead of scanning the
   * user's rows.
   */
  async #remainingDailyBudget(userId: string, timezone: string): Promise<number> {
    const now = this.#now();
    const since = new Date(now.getTime() - LOCAL_DAY_LOOKBACK_MS);
    const today = safeDateKey(now, timezone);

    const recent = await this.#prisma.notification.findMany({
      where: {
        userId,
        pushedAt: { gte: since },
        createdAt: { gte: since },
        // Exempt types never consumed budget when they were sent, so they must not
        // be counted here either; the two halves of that rule have to agree.
        type: { notIn: [...CAP_EXEMPT] },
      },
      select: { pushedAt: true },
    });

    const usedToday = recent.filter(
      (row) => row.pushedAt !== null && safeDateKey(row.pushedAt, timezone) === today,
    ).length;

    return Math.max(0, DAILY_PUSH_LIMIT - usedToday);
  }

  /** Live (non-disabled, syntactically valid) Expo tokens, grouped by owner. */
  async #liveTokensByUser(userIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.#prisma.pushToken.findMany({
      where: { userId: { in: [...userIds] }, disabledAt: null },
      select: { userId: true, token: true },
    });

    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      // Expo rejects a whole chunk when one address is malformed, so a single junk
      // token stored by an old client build would otherwise take down every
      // notification batched with it.
      if (!Expo.isExpoPushToken(row.token)) continue;
      const bucket = grouped.get(row.userId);
      if (bucket) bucket.push(row.token);
      else grouped.set(row.userId, [row.token]);
    }
    return grouped;
  }

  /**
   * Sends every message, in chunks, and reads the tickets back.
   *
   * CHUNKING IS NOT AN OPTIMISATION. Expo caps a single request at 100 messages and
   * rejects anything larger outright, so a batch that grows past that would fail
   * entirely rather than partially. `chunkPushNotifications` is the SDK's own
   * splitter, used instead of a hand-rolled `slice(0, 100)` because the limit is the
   * SDK's to know and it also accounts for messages addressed to several tokens.
   *
   * A CHUNK THAT THROWS IS NOT A BATCH THAT FAILS. Expo returns HTTP errors for
   * transport problems and rate limits, and one bad chunk must not cost the other
   * ninety-nine messages their delivery — the rows in the failed chunk simply stay
   * unpushed and come back on the next run.
   */
  async #send(
    messages: ExpoPushMessage[],
    addressed: readonly Addressed[],
  ): Promise<{ accepted: Set<string>; deadTokens: Set<string> }> {
    const accepted = new Set<string>();
    const deadTokens = new Set<string>();

    const chunks = this.#expo.chunkPushNotifications(messages);
    // Tickets come back index-aligned with the messages of their chunk, so the
    // running offset is how a ticket is traced back to its notification and token.
    let offset = 0;

    for (const chunk of chunks) {
      const base = offset;
      offset += chunk.length;

      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.#expo.sendPushNotificationsAsync(chunk);
      } catch {
        continue;
      }

      for (const [index, ticket] of tickets.entries()) {
        const target = addressed[base + index];
        if (!target) continue;

        if (ticket.status === 'ok') {
          accepted.add(target.notificationId);
          continue;
        }

        // DeviceNotRegistered is the one error that is about the TOKEN rather than
        // the message: the app was uninstalled or the token rotated, and every future
        // send to it will fail the same way. Expo reports the offending address in
        // `details.expoPushToken`, but falls back to the one we addressed.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.add(ticket.details.expoPushToken ?? target.token);
        }
      }
    }

    return { accepted, deadTokens };
  }

  /**
   * Marks dead tokens disabled. NEVER DELETES THEM, as the schema comment requires:
   * a deleted row cannot tell "never registered" from "registered, then uninstalled",
   * and the difference is the whole of a push-adoption metric. It also matters on the
   * way back — `registerPushToken` clears `disabledAt` when a device returns, which
   * only works if the row survived.
   */
  async #disableTokens(tokens: ReadonlySet<string>): Promise<string[]> {
    if (tokens.size === 0) return [];
    const list = [...tokens];
    await this.#prisma.pushToken.updateMany({
      where: { token: { in: list }, disabledAt: null },
      data: { disabledAt: this.#now() },
    });
    return list;
  }
}

function emptyResult(): PushDeliveryResult {
  return {
    delivered: [],
    skippedByDailyLimit: [],
    skippedNoDevice: [],
    failed: [],
    disabledTokens: [],
  };
}

/**
 * `localDateKey`, but a corrupt timezone cannot stop a delivery run.
 *
 * The helper throws a RangeError on an unrecognised zone — correct for streaks, where
 * a silent UTC fallback would corrupt a user's record. Here the stake is one
 * notification's slot in a daily budget, so the schema's default zone is the better
 * answer than an exception that would strand the whole batch.
 */
function safeDateKey(instant: Date, timeZone: string): string {
  try {
    return localDateKey(instant, timeZone);
  } catch {
    return localDateKey(instant, FALLBACK_TIMEZONE);
  }
}
