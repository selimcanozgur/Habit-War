/**
 * The social graph — friendships, follows and user search.
 *
 * Three rules run through every query in this file, and getting any of them wrong is
 * a correctness or a safety bug rather than a cosmetic one:
 *
 *  1. ONE ROW PER PAIR. `Friendship.pairKey` is the direction-free identity of a
 *     pair, and the database enforces its uniqueness. It is computed in exactly one
 *     place here (`pairKeyFor`); no call site re-derives it.
 *  2. BLOCKS FILTER BOTH WAYS. A query that hides only the people I blocked still
 *     shows me the people who blocked me — and the absence of someone who was there
 *     yesterday tells them exactly what happened. Every read goes through
 *     `blockedUserIds`.
 *  3. SOFT-DELETED USERS ARE INVISIBLE. `User.deletedAt` is not filtered by Prisma
 *     for us; each social query applies `deletedAt: null` itself, or a KVKK-erased
 *     account keeps appearing in other people's friend lists.
 */

import type { Friendship, PrismaClient } from '@prisma/client';
import { levelProgress, statPointsFromXp } from '@habitwar/domain';

import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { copy } from '../notifications/copy.js';
import { NotificationService } from '../notifications/service.js';

/** Injectable clock — keeps the service deterministic under test. */
export type Clock = () => Date;

export interface FriendServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
  /**
   * Injectable so a test can assert on what was recorded without a second database
   * read. Defaults to a service over the same prisma/clock, so nothing else has to
   * change to wire it up.
   */
  readonly notifications?: NotificationService | undefined;
}

/**
 * The public shape of another user. Deliberately narrow: no email, no passwordHash, no
 * timezone, no birth date. Everything here is already visible on a profile screen.
 */
export interface PublicProfile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly level: number;
  readonly prestige: number;
  readonly classType: string | null;
  /** Longest active streak across the user's habits — the number a profile shows. */
  readonly currentStreak: number;
  readonly totalStatPoints: number;
}

export interface FriendSummary extends PublicProfile {
  readonly friendshipId: string;
  /** Null only for rows accepted before `acceptedAt` was populated. */
  readonly friendsSince: Date | null;
}

export interface PendingRequest {
  readonly friendshipId: string;
  readonly createdAt: Date;
  readonly user: PublicProfile;
}

export interface PendingRequests {
  readonly incoming: readonly PendingRequest[];
  readonly outgoing: readonly PendingRequest[];
}

export interface FriendRequestResult {
  readonly friendship: Friendship;
  /**
   * True when the request completed an existing request in the other direction and
   * was therefore accepted immediately. The client renders "you are now friends"
   * rather than "request sent".
   */
  readonly autoAccepted: boolean;
}

/**
 * The columns a public profile needs. Selected explicitly rather than returning the
 * whole row: `User` carries email, passwordHash and birthDate, and a `select` is the only
 * thing standing between "we added a column" and "we leaked a column".
 */
const PROFILE_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  level: true,
  prestige: true,
  classType: true,
  cycleXp: true,
  strengthXp: true,
  enduranceXp: true,
  intelligenceXp: true,
  wisdomXp: true,
  charismaXp: true,
  dexterityXp: true,
  habits: {
    where: { isArchived: false },
    select: { currentStreak: true },
  },
} as const;

/** The row shape `PROFILE_SELECT` produces. */
interface ProfileRow {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly level: number;
  readonly prestige: number;
  readonly classType: string | null;
  readonly cycleXp: number;
  readonly strengthXp: number;
  readonly enduranceXp: number;
  readonly intelligenceXp: number;
  readonly wisdomXp: number;
  readonly charismaXp: number;
  readonly dexterityXp: number;
  readonly habits: readonly { readonly currentStreak: number }[];
}

/**
 * The direction-free identity of a pair, per the schema contract:
 * `[a, b].sort().join(':')`.
 *
 * THE ONLY PLACE THIS IS COMPUTED. `Friendship.pairKey` carries a @unique, so a
 * second spelling of this rule elsewhere would not produce a subtly wrong ordering —
 * it would produce a second row for a pair the rest of the system counts once.
 */
export function pairKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export class FriendService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;
  readonly #notifications: NotificationService;

  constructor({ prisma, now, notifications }: FriendServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
    this.#notifications = notifications ?? new NotificationService({ prisma, now });
  }

  // -------------------------------------------------------------------------
  // Friendships
  // -------------------------------------------------------------------------

  /** Accepted friends, with the profile fields the friends list renders. */
  async listFriends(userId: string): Promise<readonly FriendSummary[]> {
    const blocked = await this.#blockedUserIds(userId);

    const rows = await this.#prisma.friendship.findMany({
      where: {
        status: 'ACCEPTED',
        // Either side of the pair may be me; direction is meaningless once accepted.
        OR: [{ requesterId: userId }, { addresseeId: userId }],
        requester: { deletedAt: null },
        addressee: { deletedAt: null },
      },
      orderBy: { acceptedAt: 'desc' },
      include: {
        requester: { select: PROFILE_SELECT },
        addressee: { select: PROFILE_SELECT },
      },
    });

    return rows
      .map((row) => ({
        row,
        other: row.requesterId === userId ? row.addressee : row.requester,
      }))
      .filter(({ other }) => !blocked.has(other.id))
      .map(({ row, other }) => ({
        ...toPublicProfile(other),
        friendshipId: row.id,
        friendsSince: row.acceptedAt,
      }));
  }

  /**
   * Pending requests in both directions.
   *
   * Returned as one payload because the UI shows them on one screen; splitting them
   * across two endpoints would only make it two round trips.
   */
  async listRequests(userId: string): Promise<PendingRequests> {
    const blocked = await this.#blockedUserIds(userId);

    const [incoming, outgoing] = await Promise.all([
      this.#prisma.friendship.findMany({
        where: { status: 'PENDING', addresseeId: userId, requester: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        include: { requester: { select: PROFILE_SELECT } },
      }),
      this.#prisma.friendship.findMany({
        where: { status: 'PENDING', requesterId: userId, addressee: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        include: { addressee: { select: PROFILE_SELECT } },
      }),
    ]);

    return {
      incoming: incoming
        .filter((row) => !blocked.has(row.requesterId))
        .map((row) => ({
          friendshipId: row.id,
          createdAt: row.createdAt,
          user: toPublicProfile(row.requester),
        })),
      outgoing: outgoing
        .filter((row) => !blocked.has(row.addresseeId))
        .map((row) => ({
          friendshipId: row.id,
          createdAt: row.createdAt,
          user: toPublicProfile(row.addressee),
        })),
    };
  }

  /**
   * Sends a friend request, by username.
   *
   * MUTUAL REQUESTS ARE NOT A CONFLICT. If B already has a PENDING request out to A
   * and A now requests B, both people have expressed the same intent — that is an
   * acceptance, not a collision. The existing row is flipped to ACCEPTED in place,
   * which is also the only outcome the database permits: `pairKey` is unique, so a
   * second PENDING row for the pair could not be written even if we tried.
   */
  async requestByUsername(userId: string, username: string): Promise<FriendRequestResult> {
    const target = await this.#findTargetByUsername(username);

    // Checked first: for a self-request every later rule (blocks, existing rows,
    // pairKey) would read as "already friends" and mask the real mistake.
    if (target.id === userId) throw badRequest('You cannot send a friend request to yourself');

    await this.#assertNotBlocked(userId, target.id);

    const pairKey = pairKeyFor(userId, target.id);
    const existing = await this.#prisma.friendship.findUnique({ where: { pairKey } });

    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw conflict('You are already friends', { friendshipId: existing.id });
      }
      if (existing.status === 'BLOCKED') {
        // Surfaced as the same 404 an unknown username gets, so the row's existence
        // does not confirm who blocked whom.
        throw notFound('User not found');
      }
      if (existing.requesterId === userId) {
        throw conflict('A request to this user is already pending', {
          friendshipId: existing.id,
        });
      }

      // They asked us first, so this call is the acceptance.
      const friendship = await this.#prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED', acceptedAt: this.#now() },
      });
      // The other side asked and is now owed the answer — FRIEND_ACCEPTED, not
      // FRIEND_REQUEST: from their point of view nothing was requested of them.
      await this.#notifyFriendAccepted(userId, existing.requesterId);
      return { friendship, autoAccepted: true };
    }

    const friendship = await this.#prisma.friendship.create({
      data: { requesterId: userId, addresseeId: target.id, pairKey, status: 'PENDING' },
    });

    // Written after the row commits and never inside its transaction: a friend
    // request that failed because the notification failed would be a worse bug than
    // a request the recipient has to discover on the requests screen.
    await this.#notifications.createSafely({
      userId: target.id,
      actorId: userId,
      type: 'FRIEND_REQUEST',
      ...copy.friendRequest(await this.#notifications.actorDisplayName(userId)),
      // USER + the requester, so tapping opens the profile the request came from —
      // which is where the accept button lives. There is no FRIENDSHIP target type.
      targetType: 'USER',
      targetId: userId,
    });

    return { friendship, autoAccepted: false };
  }

  /** Accepts a pending request. Only the addressee may do this. */
  async accept(userId: string, friendshipId: string): Promise<Friendship> {
    const existing = await this.#loadPendingForDecision(userId, friendshipId);
    const friendship = await this.#prisma.friendship.update({
      where: { id: existing.id },
      data: { status: 'ACCEPTED', acceptedAt: this.#now() },
    });

    await this.#notifyFriendAccepted(userId, existing.requesterId);
    return friendship;
  }

  /**
   * Tells the original requester their request was accepted.
   *
   * Shared by the two paths that can accept one — an explicit `accept`, and a
   * mutual request where B asking for A while A's request is pending IS the
   * acceptance. Both owe the requester the same notice, and writing it twice is how
   * the two drift apart.
   *
   * The actor is whoever accepted; the target is their profile, since that is what
   * the requester will want to open.
   */
  async #notifyFriendAccepted(accepterId: string, requesterId: string): Promise<void> {
    await this.#notifications.createSafely({
      userId: requesterId,
      actorId: accepterId,
      type: 'FRIEND_ACCEPTED',
      ...copy.friendAccepted(await this.#notifications.actorDisplayName(accepterId)),
      targetType: 'USER',
      targetId: accepterId,
    });
  }

  /**
   * Declines a pending request.
   *
   * DELIBERATELY SILENT. There is no FRIEND_DECLINED notification type and there
   * should not be one: telling someone they were turned down is a message with no
   * action attached, and the row's disappearance from their outgoing list already
   * says it to anyone who looks. It also keeps a decline indistinguishable from a
   * block, which is what makes blocking safe to use.
   *
   * The row is deleted rather than moved to a declined state: `FriendshipStatus` has
   * no such member, and keeping a rejected row under a unique `pairKey` would
   * permanently bar the pair from ever becoming friends — a decline the requester
   * later regrets has to be re-sendable.
   */
  async decline(userId: string, friendshipId: string): Promise<void> {
    const existing = await this.#loadPendingForDecision(userId, friendshipId);
    await this.#prisma.friendship.delete({ where: { id: existing.id } });
  }

  /**
   * Removes a friendship. Either side may do this, unlike accept/decline.
   *
   * Deleted, not soft-deleted: an ex-friendship carries no history worth keeping, and
   * the pair must be free to befriend each other again — which the unique `pairKey`
   * would otherwise prevent forever.
   */
  async remove(userId: string, friendshipId: string): Promise<void> {
    const existing = await this.#prisma.friendship.findUnique({ where: { id: friendshipId } });
    // 404 rather than 403 for a row belonging to two other people: the caller has no
    // business learning that this id exists.
    if (!existing || (existing.requesterId !== userId && existing.addresseeId !== userId)) {
      throw notFound('Friendship not found');
    }
    await this.#prisma.friendship.delete({ where: { id: existing.id } });
  }

  // -------------------------------------------------------------------------
  // Follows
  // -------------------------------------------------------------------------

  /**
   * Follows a user. One-directional and consent-free by design — a follow grants
   * content discovery only, never the competitive privileges friendship grants.
   *
   * Idempotent: re-following reaches the same end state, and a 409 would only force
   * the client to special-case a button it should be able to press twice.
   */
  async follow(userId: string, username: string): Promise<{ followingId: string }> {
    const target = await this.#findTargetByUsername(username);
    if (target.id === userId) throw badRequest('You cannot follow yourself');

    await this.#assertNotBlocked(userId, target.id);

    const existing = await this.#prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: userId, followingId: target.id } },
      select: { id: true },
    });

    await this.#prisma.follow.upsert({
      where: { followerId_followingId: { followerId: userId, followingId: target.id } },
      create: { followerId: userId, followingId: target.id },
      // Nothing to change — the upsert exists purely to absorb the duplicate.
      update: {},
    });

    // Only on a genuinely new follow. The endpoint is idempotent, so a client that
    // retries a dropped response would otherwise ping the same person twice for one
    // follow — and re-following after unfollowing is a known way to farm attention.
    if (!existing) {
      await this.#notifications.createSafely({
        userId: target.id,
        actorId: userId,
        type: 'NEW_FOLLOWER',
        ...copy.newFollower(await this.#notifications.actorDisplayName(userId)),
        targetType: 'USER',
        targetId: userId,
      });
    }

    return { followingId: target.id };
  }

  /**
   * Unfollows a user.
   *
   * `deleteMany` rather than `delete`: unfollowing someone you do not follow is a
   * no-op rather than a 404, which also keeps the blocked and deleted cases
   * indistinguishable from the ordinary one.
   */
  async unfollow(userId: string, username: string): Promise<void> {
    const target = await this.#prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!target) return;
    await this.#prisma.follow.deleteMany({
      where: { followerId: userId, followingId: target.id },
    });
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Finds users by username or display name.
   *
   * NEVER by email. Matching on email would turn this into an oracle answering "does
   * this address have an account here?" for anything a caller cares to try, which is
   * a disclosure with no upside — nobody looks for a friend by typing their email
   * into a game.
   *
   * The caller is excluded from their own results, as is anyone on either side of a
   * block. The three-character floor and the result cap live in `schemas.ts`.
   */
  async searchUsers(userId: string, q: string, limit: number): Promise<readonly PublicProfile[]> {
    const blocked = await this.#blockedUserIds(userId);

    const rows = await this.#prisma.user.findMany({
      where: {
        deletedAt: null,
        id: { not: userId, notIn: [...blocked] },
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      // A cheap, stable approximation of relevance; a real ranking needs a full-text
      // index, which Phase 1 does not have.
      orderBy: { username: 'asc' },
      take: limit,
      select: PROFILE_SELECT,
    });

    return rows.map(toPublicProfile);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Every user id on either end of a block involving this user.
   *
   * Both directions in one set, because filtering only `blockerId = me` leaves the
   * people who blocked me fully visible to me — and leaves me able to friend-request
   * someone who explicitly opted out of hearing from me.
   */
  async #blockedUserIds(userId: string): Promise<ReadonlySet<string>> {
    const rows = await this.#prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }
    return ids;
  }

  /**
   * Rejects an interaction with someone on either side of a block.
   *
   * The error is the same 404 an unknown username produces. "You are blocked" would
   * tell the blocked party that they were blocked, which is exactly what a silent
   * block exists to avoid.
   */
  async #assertNotBlocked(userId: string, targetId: string): Promise<void> {
    const block = await this.#prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: targetId },
          { blockerId: targetId, blockedId: userId },
        ],
      },
      select: { id: true },
    });
    if (block) throw notFound('User not found');
  }

  /** Resolves a username to a live account, or 404s. */
  async #findTargetByUsername(username: string): Promise<{ id: string }> {
    const target = await this.#prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw notFound('User not found');
    return target;
  }

  /**
   * Loads a PENDING friendship the caller is entitled to accept or decline.
   *
   * The asymmetry is the point: only the addressee decides. A requester hitting
   * accept on their own request would befriend someone who never agreed, so that is a
   * 403 and not a quietly-ignored no-op.
   */
  async #loadPendingForDecision(userId: string, friendshipId: string): Promise<Friendship> {
    const existing = await this.#prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!existing) throw notFound('Friend request not found');

    if (existing.addresseeId !== userId) {
      // The requester gets 403 — they know the row exists, they created it. Anyone
      // unrelated gets 404, because for them the id should not resolve at all.
      if (existing.requesterId === userId) {
        throw forbidden('Only the recipient of a request may respond to it');
      }
      throw notFound('Friend request not found');
    }

    if (existing.status !== 'PENDING') {
      throw conflict(`Request is already ${existing.status.toLowerCase()}`);
    }
    return existing;
  }
}

/**
 * Projects a selected user row onto the public profile shape.
 *
 * `level` is recomputed from `cycleXp` rather than read off the denormalised column:
 * that column is a sort cache maintained by the session-write path, and a profile
 * disagreeing with the user's own XP bar is a bug report every time.
 */
function toPublicProfile(row: ProfileRow): PublicProfile {
  const statPoints =
    statPointsFromXp(row.strengthXp) +
    statPointsFromXp(row.enduranceXp) +
    statPointsFromXp(row.intelligenceXp) +
    statPointsFromXp(row.wisdomXp) +
    statPointsFromXp(row.charismaXp) +
    statPointsFromXp(row.dexterityXp);

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    level: levelProgress(row.cycleXp).level,
    prestige: row.prestige,
    classType: row.classType,
    // The headline streak is the best one the user currently holds; summing or
    // averaging across habits would show a number they never see on their own screen.
    currentStreak: row.habits.reduce((best, habit) => Math.max(best, habit.currentStreak), 0),
    totalStatPoints: statPoints,
  };
}
