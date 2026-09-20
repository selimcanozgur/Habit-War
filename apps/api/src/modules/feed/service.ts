/**
 * Feed, posts, likes and replies.
 *
 * Four decisions are load-bearing here and are argued where they are implemented:
 *
 *  1. Pagination is a keyset cursor over `(createdAt, id)`, never an offset.
 *  2. Automatic session posts aggregate into one DAILY_DIGEST per author per local
 *     day. A standalone SESSION_COMPLETE post is an explicit user choice.
 *  3. Blocks are filtered in BOTH directions on every social read.
 *  4. `likeCount` / `commentCount` are denormalised and are only ever moved inside
 *     the same transaction as the row that justifies the move.
 */

import type { Prisma, PrismaClient, Post } from '@prisma/client';
import { localDateKey } from '@habitwar/domain';

import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';

/** Injectable clock — keeps the service deterministic under test. */
export type Clock = () => Date;

export interface FeedServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

export type FeedScope = 'friends' | 'discover';

export interface FeedPageInput {
  readonly userId: string;
  readonly scope: FeedScope;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** A feed row: the Post columns plus the two viewer-relative fields the client needs. */
export type FeedItem = Post & {
  readonly isDeleted: boolean;
  readonly viewerHasLiked: boolean;
};

export interface FeedPage {
  readonly items: readonly FeedItem[];
  /** Opaque; pass back verbatim as `cursor`. Null when the page is the last one. */
  readonly nextCursor: string | null;
}

export interface CreatePostInput {
  readonly userId: string;
  readonly type: 'TEXT' | 'IMAGE';
  readonly content?: string | undefined;
  readonly mediaUrls?: readonly string[] | undefined;
}

export interface CreateReplyInput {
  readonly userId: string;
  readonly parentId: string;
  readonly content: string;
}

export interface DigestInput {
  readonly userId: string;
  /** Defaults to 1 — one completed session folded into the day. */
  readonly sessions?: number | undefined;
  readonly xp: number;
  readonly minutes: number;
  readonly category: string;
  /** The moment being attributed. Defaults to now; tests and backfills pass it. */
  readonly at?: Date | undefined;
}

export interface PublishSessionPostInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly content?: string | undefined;
}

/** Rolled-up numbers stored in `Post.digestStats`. */
export interface DigestStats {
  readonly sessions: number;
  readonly xp: number;
  readonly minutes: number;
  readonly categories: readonly string[];
}

/**
 * The author fields every feed row carries. Selected explicitly rather than
 * `include: { author: true }` so a future column on User (email, clerkId, birthDate)
 * cannot leak into a social response by default.
 */
const AUTHOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  level: true,
  classType: true,
} satisfies Prisma.UserSelect;

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

interface CursorPosition {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * Encodes the keyset position as an opaque base64url string.
 *
 * OFFSET is wrong for a feed, not merely slower. Between two page requests the
 * underlying set shifts — a friend posts, a post is deleted, a block lands — and an
 * offset counts into a list whose prefix no longer has the same length. One
 * insertion ahead of the cursor repeats a row; one deletion skips one. A keyset
 * cursor names a POSITION IN THE ORDERING, so it stays correct under both.
 *
 * The pair `(createdAt, id)` and not `createdAt` alone: two posts routinely land in
 * the same millisecond, and a createdAt-only cursor then either drops rows or serves
 * them twice at every page boundary where a tie falls. `id` is the total-order
 * tiebreaker, and the schema's
 * `@@index([authorId, createdAt(sort: Desc), id(sort: Desc)])` is what makes the
 * comparison a seek rather than a sort.
 *
 * Base64 and not a raw `createdAt:id` string so clients cannot build one by hand.
 * The day the cursor grows a third component, every caller that parsed it would
 * break; an opaque token has no shape to depend on.
 */
function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt.toISOString()}|${position.id}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(raw: string): CursorPosition {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw badRequest('Malformed cursor');
  }

  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) throw badRequest('Malformed cursor');

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) throw badRequest('Malformed cursor');

  return { createdAt, id };
}

/**
 * The keyset predicate for a DESC ordering: strictly older, or the same instant with
 * a strictly smaller id.
 *
 * Written as an explicit OR rather than with Prisma's `cursor` + `skip`, because
 * `cursor` takes a single unique field and cannot express the tiebreak — using it
 * would reintroduce exactly the row-skipping this exists to prevent.
 */
function keysetBefore(position: CursorPosition): Prisma.PostWhereInput {
  return {
    OR: [
      { createdAt: { lt: position.createdAt } },
      { createdAt: position.createdAt, id: { lt: position.id } },
    ],
  };
}

/** The same predicate for an ASC ordering — reply threads read oldest-first. */
function keysetAfter(position: CursorPosition): Prisma.PostWhereInput {
  return {
    OR: [
      { createdAt: { gt: position.createdAt } },
      { createdAt: position.createdAt, id: { gt: position.id } },
    ],
  };
}

export class FeedService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: FeedServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // Feed
  // -------------------------------------------------------------------------

  /**
   * A page of the viewer's feed, newest first.
   *
   * RANKING: chronological, filtered by the social graph. The spec offers
   * `0.5 x closeness + 0.3 x recency + 0.2 x engagement` and this deliberately does
   * NOT implement it, for two reasons.
   *
   * First, the formula is unusable as written: the three terms are in incomparable
   * units (a friendship age in days, a post age in hours, a like count) with no
   * normalisation, so the weights simply amplify whichever term happens to carry the
   * largest raw magnitude and the coefficients express nothing about intent.
   *
   * Second, the spec itself says "start chronological + friend filter" and "do not go
   * near ML ranking before 10k DAU" in the same paragraph. A scored feed at this
   * stage tunes engagement against a population too small to measure it on.
   *
   * Chronological is also the only ordering a keyset cursor paginates correctly
   * without materialising a score column, which matters more today than ranking
   * does. Revisit with normalised terms and a stable tiebreak when the audience
   * justifies it.
   */
  async feed({ userId, scope, cursor, limit }: FeedPageInput): Promise<FeedPage> {
    const authorIds = await this.#authorIdsFor(userId, scope);

    // An empty author set is a legitimate state (a brand-new account), not an error.
    if (authorIds.length === 0) return { items: [], nextCursor: null };

    const where: Prisma.PostWhereInput = {
      authorId: { in: authorIds },
      // Top-level posts only. Replies live in the thread, not the feed — surfacing
      // one here would show a comment without the post it answers.
      parentId: null,
      deletedAt: null,
      isHidden: false,
      // Social queries own this filter: there is no global Prisma middleware
      // excluding soft-deleted users, so every reader must apply it or a KVKK
      // erasure request would keep publishing its author's posts.
      author: { deletedAt: null },
      ...(cursor ? keysetBefore(decodeCursor(cursor)) : {}),
    };

    // Over-fetch by one. Whether a next page exists is then a fact about rows already
    // in hand, rather than a second COUNT over the same predicate.
    const rows = await this.#prisma.post.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { author: { select: AUTHOR_SELECT } },
    });

    return this.#page(rows, limit, userId);
  }

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------

  /** Creates a user-authored post. Only TEXT and IMAGE reach here — see schemas.ts. */
  async createPost({ userId, type, content, mediaUrls }: CreatePostInput): Promise<Post> {
    // `imageUrl` is a single column; the boundary caps `mediaUrls` at one entry so
    // this never silently discards part of what a user submitted.
    const imageUrl = mediaUrls?.[0] ?? null;

    return this.#prisma.post.create({
      data: {
        authorId: userId,
        type,
        content: content ?? null,
        imageUrl,
      },
    });
  }

  /**
   * Soft-deletes the caller's own post.
   *
   * REPLIES SURVIVE A DELETED PARENT. Deleting a post sets `deletedAt` and nothing
   * cascades, which is the behaviour the schema already encodes — the `PostThread`
   * self-relation is `onDelete: SetNull` and `Report.postId` is `SetNull` for the
   * same reason. Three arguments:
   *
   *  - Deleting a parent would destroy other people's writing as collateral damage,
   *    and one of those replies may be the subject of an open Report; the evidence
   *    would vanish mid-investigation.
   *  - Keeping the row keeps `commentCount` meaningful and lets the thread endpoint
   *    still render, showing a tombstone rather than a hole.
   *  - Cascading is recoverable once, at best. Not cascading is reversible at any
   *    time — the opposite choice can still be made later by a purge job.
   *
   * The replies stay reachable through `GET /posts/:id/replies`, which serves a
   * tombstoned parent, but never surface in the feed, because the feed selects only
   * `parentId: null`. The parent's own body is withheld by the read path.
   */
  async deletePost(userId: string, postId: string): Promise<Post> {
    const post = await this.#prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt) throw notFound('Post not found');
    if (post.authorId !== userId) throw forbidden('You can only delete your own posts');

    const now = this.#now();
    const parentId = post.parentId;

    // If this post is itself a reply, the parent's commentCount must come down in the
    // same transaction as the deletion — the whole point of a denormalised counter is
    // that it is never observable out of step with the rows it counts.
    if (parentId !== null) {
      const [deleted] = await this.#prisma.$transaction([
        this.#prisma.post.update({ where: { id: postId }, data: { deletedAt: now } }),
        this.#prisma.post.update({
          where: { id: parentId },
          data: { commentCount: { decrement: 1 } },
        }),
      ]);
      return deleted;
    }

    return this.#prisma.post.update({ where: { id: postId }, data: { deletedAt: now } });
  }

  // -------------------------------------------------------------------------
  // Likes
  // -------------------------------------------------------------------------

  /**
   * Likes a post — or a reply, since a reply is a Post, so this is one code path.
   *
   * The PostLike insert and the `likeCount` increment are ONE transaction. Split
   * apart, a failure between them leaves a counter permanently wrong with no record
   * of by how much, and `@@unique([postId, userId])` then makes the drift
   * unrepairable by retry: the second attempt hits the unique index and never reaches
   * the increment.
   */
  async like(userId: string, postId: string): Promise<{ likeCount: number; liked: boolean }> {
    const post = await this.#visiblePostOrThrow(userId, postId);

    const existing = await this.#prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    // Idempotent: a double-tap or a retried request must not move the counter twice.
    if (existing) return { likeCount: post.likeCount, liked: true };

    try {
      const [, updated] = await this.#prisma.$transaction([
        this.#prisma.postLike.create({ data: { postId, userId } }),
        this.#prisma.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
      return { likeCount: updated.likeCount, liked: true };
    } catch (error) {
      // Two concurrent likes from the same user: the loser hits the unique index and
      // the whole transaction — increment included — rolls back, which is the correct
      // outcome. Report the winner's state rather than an error the client cannot act
      // on.
      if (isUniqueViolation(error)) {
        const current = await this.#prisma.post.findUnique({
          where: { id: postId },
          select: { likeCount: true },
        });
        return { likeCount: current?.likeCount ?? post.likeCount, liked: true };
      }
      throw error;
    }
  }

  /** Removes a like. Same transactional rule as `like`, in reverse. */
  async unlike(userId: string, postId: string): Promise<{ likeCount: number; liked: boolean }> {
    const post = await this.#visiblePostOrThrow(userId, postId);

    const existing = await this.#prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!existing) return { likeCount: post.likeCount, liked: false };

    const [, updated] = await this.#prisma.$transaction([
      this.#prisma.postLike.delete({ where: { postId_userId: { postId, userId } } }),
      this.#prisma.post.update({
        where: { id: postId },
        // Clamped at zero by the write path rather than by a check constraint: a
        // counter that has somehow drifted to zero should heal, not start failing
        // every subsequent unlike.
        data: { likeCount: { decrement: post.likeCount > 0 ? 1 : 0 } },
      }),
    ]);
    return { likeCount: updated.likeCount, liked: false };
  }

  // -------------------------------------------------------------------------
  // Replies
  // -------------------------------------------------------------------------

  /**
   * A page of a post's replies, OLDEST FIRST — a conversation reads forward, and the
   * schema indexes `@@index([parentId, createdAt])` in that direction.
   *
   * A soft-deleted parent still serves its thread; see `deletePost`.
   */
  async replies(
    userId: string,
    parentId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<FeedPage> {
    const parent = await this.#prisma.post.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) throw notFound('Post not found');

    const blockedIds = await this.#blockedUserIds(userId);

    const where: Prisma.PostWhereInput = {
      parentId,
      deletedAt: null,
      isHidden: false,
      author: { deletedAt: null },
      // Blocks apply inside a thread too. Reading a blocked user's reply under a post
      // both parties can see is the most common way a block leaks.
      ...(blockedIds.length > 0 ? { authorId: { notIn: blockedIds } } : {}),
      ...(cursor ? keysetAfter(decodeCursor(cursor)) : {}),
    };

    const rows = await this.#prisma.post.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: { author: { select: AUTHOR_SELECT } },
    });

    return this.#page(rows, limit, userId);
  }

  /**
   * Creates a reply. A reply IS a Post with `parentId` set — one moderation path
   * (Report to Post), one like path, one delete path, as the schema intends.
   */
  async createReply({ userId, parentId, content }: CreateReplyInput): Promise<Post> {
    const parent = await this.#visiblePostOrThrow(userId, parentId);

    // One level deep. Threading replies-to-replies needs a materialised path or a
    // recursive read to render, and the schema indexes only `[parentId, createdAt]`
    // — an arbitrarily deep tree would be N queries per screen. Replying to a reply
    // attaches to its parent instead, which is what the client renders anyway.
    if (parent.parentId !== null) {
      throw conflict('Replies are one level deep; reply to the original post instead', {
        parentId: parent.parentId,
      });
    }

    const [reply] = await this.#prisma.$transaction([
      this.#prisma.post.create({
        data: {
          authorId: userId,
          type: 'TEXT',
          content,
          parentId,
        },
      }),
      this.#prisma.post.update({
        where: { id: parentId },
        data: { commentCount: { increment: 1 } },
      }),
    ]);
    return reply;
  }

  // -------------------------------------------------------------------------
  // Automatic posts — digest vs. standalone
  // -------------------------------------------------------------------------

  /**
   * Folds a completed session into the author's DAILY_DIGEST post.
   *
   * THIS IS THE DEFAULT PATH for automatic posts, and it is the spec's own answer to
   * its stated noise risk (section 5.1). One post per session turns the feed into
   * spam within a week of a user building a habit stack, because the people most
   * worth following are exactly the people who generate the most sessions. So the
   * automatic path aggregates — "3 sessions, 145 XP today" — and a standalone
   * SESSION_COMPLETE post is produced ONLY by `publishSessionPost`, which a user
   * invokes explicitly. The two functions exist separately so that default and
   * choice are different code paths rather than a boolean argument someone will get
   * backwards.
   *
   * IDEMPOTENT BY CONSTRUCTION: `@@unique([authorId, digestDate])` means the upsert
   * targets exactly one row per author per local day, so this can run on every
   * session completion, be retried, or run concurrently with itself without ever
   * producing two digests. The stats it writes are a merge of what it read, so the
   * invariant the CALLER must hold is different and narrower: call this once per
   * session. The session service's own idempotency (`clientRequestId`, and a
   * COMPLETED session refusing to be completed twice) already guarantees that.
   *
   * `digestDate` is the author's LOCAL day via the same `localDateKey` helper and the
   * same YYYY-MM-DD convention as `DailyUsage.dateKey` and `Habit.lastCompletedDate`.
   * A UTC day would push an evening session in Istanbul into the next day's digest,
   * and the digest would then disagree with the daily caps computed from the same
   * session.
   *
   * NOT SCHEDULED. No cron and no BullMQ job is wired here — this is the function
   * such a job, or the session-completion path, calls. Choosing the trigger belongs
   * to the session module, not to the feed.
   */
  async upsertDailyDigest(input: DigestInput): Promise<Post> {
    const { userId, xp, minutes, category } = input;
    const sessions = input.sessions ?? 1;

    const user = await this.#prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, timezone: true },
    });
    if (!user) throw notFound('User not found');

    const at = input.at ?? this.#now();
    const digestDate = localDateKey(at, user.timezone);

    // Read-then-merge rather than an in-place Json increment: Postgres cannot
    // increment inside a jsonb column through Prisma, and a digest is written a
    // handful of times a day per user at most, so the extra read is cheap. The unique
    // constraint, not this read, is what makes the write safe.
    const existing = await this.#prisma.post.findUnique({
      where: { authorId_digestDate: { authorId: userId, digestDate } },
      select: { digestStats: true },
    });

    const previous = readDigestStats(existing?.digestStats);
    const merged: DigestStats = {
      sessions: previous.sessions + sessions,
      xp: previous.xp + xp,
      minutes: previous.minutes + minutes,
      categories: [...new Set([...previous.categories, category])].sort(),
    };

    return this.#prisma.post.upsert({
      where: { authorId_digestDate: { authorId: userId, digestDate } },
      create: {
        authorId: userId,
        type: 'DAILY_DIGEST',
        digestDate,
        digestStats: merged as unknown as Prisma.InputJsonValue,
      },
      update: {
        digestStats: merged as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Publishes a STANDALONE post for one session — the user's MANUAL choice.
   *
   * The counterpart to `upsertDailyDigest`: nothing calls this automatically. It
   * exists so that "share this session" is a distinct, deliberate act, which is
   * precisely what section 5.1 asks for — the aggregate is the default, the single
   * post is chosen.
   *
   * `Post.sessionId` is `@unique`, so a retried share can never duplicate the post;
   * the second attempt returns the first one rather than raising, because a client
   * retrying a share whose response it never saw wants convergence, not a conflict.
   */
  async publishSessionPost({
    userId,
    sessionId,
    content,
  }: PublishSessionPostInput): Promise<Post> {
    const existing = await this.#prisma.post.findUnique({ where: { sessionId } });
    if (existing) {
      if (existing.authorId !== userId) throw forbidden('Not your session');
      return existing;
    }

    const session = await this.#prisma.session.findFirst({
      where: { id: sessionId, userId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!session) throw notFound('Completed session not found');

    try {
      return await this.#prisma.post.create({
        data: {
          authorId: userId,
          type: 'SESSION_COMPLETE',
          sessionId,
          content: content ?? null,
        },
      });
    } catch (error) {
      // Lost a race against a concurrent share of the same session.
      if (isUniqueViolation(error)) {
        const winner = await this.#prisma.post.findUnique({ where: { sessionId } });
        if (winner) return winner;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Whose posts the viewer may see, minus everyone either side has blocked.
   *
   * The viewer is always included: your own posts belong in your own feed, and
   * omitting them makes a new user's very first post appear to vanish.
   */
  async #authorIdsFor(userId: string, scope: FeedScope): Promise<string[]> {
    const candidates = new Set<string>([userId]);

    if (scope === 'friends') {
      const friendships = await this.#prisma.friendship.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        select: { requesterId: true, addresseeId: true },
      });
      for (const row of friendships) {
        candidates.add(row.requesterId === userId ? row.addresseeId : row.requesterId);
      }
    } else {
      // `discover` = accounts the viewer follows. Following is one-directional and
      // needs no consent, which is exactly why it must not grant the competitive
      // privileges friendship grants — it only widens what is readable.
      const follows = await this.#prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      });
      for (const row of follows) candidates.add(row.followingId);
    }

    for (const id of await this.#blockedUserIds(userId)) candidates.delete(id);

    return [...candidates];
  }

  /**
   * Every user id in a block relationship with the viewer, IN EITHER DIRECTION.
   *
   * One direction is not enough, and the asymmetry is the point. Filtering only
   * `blockerId = me` hides the people I blocked but keeps showing me the posts of
   * someone who blocked me — and because they cannot see mine, the resulting
   * one-sided conversation is itself a disclosure that a block exists. The schema
   * indexes both `blockerId` and `blockedId` for exactly this query.
   */
  async #blockedUserIds(userId: string): Promise<string[]> {
    const rows = await this.#prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });

    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }
    return [...ids];
  }

  /**
   * Loads a post the viewer is allowed to interact with.
   *
   * A block resolves to NOT_FOUND, not FORBIDDEN: a distinct "forbidden" answer would
   * confirm both that the post exists and that a block is in place, which is the fact
   * a block is meant to conceal.
   */
  async #visiblePostOrThrow(userId: string, postId: string): Promise<Post> {
    const post = await this.#prisma.post.findFirst({
      where: {
        id: postId,
        deletedAt: null,
        isHidden: false,
        author: { deletedAt: null },
      },
    });
    if (!post) throw notFound('Post not found');

    if (post.authorId !== userId) {
      const blocked = await this.#blockedUserIds(userId);
      if (blocked.includes(post.authorId)) throw notFound('Post not found');
    }
    return post;
  }

  /**
   * Trims the over-fetched row, mints the next cursor, and decorates each row with
   * the viewer's own like state.
   *
   * `viewerHasLiked` is resolved with ONE query for the whole page. Asking per row is
   * the N+1 the denormalised counters exist to avoid, and doing it here would
   * reintroduce it on the same read path they protect.
   */
  async #page<T extends Post>(rows: T[], limit: number, viewerId: string): Promise<FeedPage> {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const last = items.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    if (items.length === 0) return { items: [], nextCursor: null };

    const likes = await this.#prisma.postLike.findMany({
      where: { userId: viewerId, postId: { in: items.map((row) => row.id) } },
      select: { postId: true },
    });
    const liked = new Set(likes.map((row) => row.postId));

    return {
      items: items.map((row) => ({
        ...row,
        // A soft-deleted parent is served as a tombstone so its thread still renders
        // (see `deletePost`); its body is never returned.
        ...(row.deletedAt !== null ? { content: null, imageUrl: null } : {}),
        isDeleted: row.deletedAt !== null,
        viewerHasLiked: liked.has(row.id),
      })),
      nextCursor,
    };
  }
}

/** Narrows a stored `digestStats` Json blob back to the shape this module writes. */
function readDigestStats(value: Prisma.JsonValue | null | undefined): DigestStats {
  const empty: DigestStats = { sessions: 0, xp: 0, minutes: 0, categories: [] };
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return empty;
  }

  const record = value as Record<string, unknown>;
  const categories = record['categories'];
  return {
    sessions: numberOr(record['sessions']),
    xp: numberOr(record['xp']),
    minutes: numberOr(record['minutes']),
    categories: Array.isArray(categories) ? categories.filter(isString) : [],
  };
}

function numberOr(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Recognises Prisma's unique-constraint violation without importing the runtime error
 * class: `Prisma.PrismaClientKnownRequestError` is a value import, which would drag
 * the client runtime into every module that imports this one.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}
