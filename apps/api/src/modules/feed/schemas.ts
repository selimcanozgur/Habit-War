/**
 * Feed, post, like and reply contracts.
 *
 * The cursor is validated as an opaque string here and decoded in the service. The
 * route layer deliberately knows nothing about its internal shape: the day the
 * cursor grows a third component (a score, a shard key) every caller that treated it
 * as structured data would break, so it is never structured data at the boundary.
 */

import { z } from 'zod';

/**
 * Post.content is `@db.VarChar(2000)` in the schema, so 2000 is the hard ceiling the
 * database will enforce. The task brief said 500; the schema is the contract that
 * actually fails a write, and silently truncating or rejecting at 500 while the
 * column accepts 2000 would be a limit no other writer of this table respects.
 * Validating at the column width keeps one number in one place.
 */
const MAX_CONTENT = 2000;

const content = z.string().trim().min(1).max(MAX_CONTENT);

/**
 * Only TEXT and IMAGE are user-creatable. SESSION_COMPLETE, LEVEL_UP, ACHIEVEMENT,
 * CHALLENGE_RESULT and DAILY_DIGEST are emitted by the systems that own the
 * underlying row (a session, a badge, a duel, the digest job). Letting a client POST
 * an ACHIEVEMENT post would let anyone claim a badge they never earned, and the
 * `@unique` columns that prevent duplicate publishers would be bypassed entirely.
 */
export const CREATABLE_POST_TYPES = ['TEXT', 'IMAGE'] as const;

/**
 * `mediaUrls` is accepted as an array because that is the client-facing shape the
 * brief specifies, but Post has a single `imageUrl` column. The service stores the
 * first entry; the cap of 1 makes the lossy step explicit at the boundary instead of
 * silently discarding the rest of a user's upload. Widening to real multi-media is a
 * schema change (a PostMedia table), not a validation change.
 */
export const createPostBody = z
  .object({
    type: z.enum(CREATABLE_POST_TYPES).default('TEXT'),
    content: content.optional(),
    mediaUrls: z.array(z.string().url()).max(1).optional(),
  })
  .refine((body) => body.type !== 'IMAGE' || (body.mediaUrls?.length ?? 0) > 0, {
    message: 'An IMAGE post requires at least one entry in mediaUrls',
    path: ['mediaUrls'],
  })
  .refine((body) => body.type !== 'TEXT' || body.content !== undefined, {
    message: 'A TEXT post requires content',
    path: ['content'],
  });

/** Replies are text-only: a comment thread is not a second media surface. */
export const createReplyBody = z.object({ content });

export const postIdParams = z.object({ id: z.string().cuid() });

/**
 * `friends` is the default scope. `discover` widens to people the user follows.
 *
 * Neither scope is a global firehose. A public "everything" feed on a product with
 * no content moderation staffing is the App Store 1.2 problem the Report/Block
 * models exist to answer, and answering it with an unranked global stream would
 * reintroduce it on day one.
 */
export const FEED_SCOPES = ['friends', 'discover'] as const;

export const feedQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  scope: z.enum(FEED_SCOPES).default('friends'),
  /** Capped: an unbounded page size turns one request into a full-table scan. */
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const repliesQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreatePostBody = z.infer<typeof createPostBody>;
export type CreateReplyBody = z.infer<typeof createReplyBody>;
export type FeedQuery = z.infer<typeof feedQuery>;
export type RepliesQuery = z.infer<typeof repliesQuery>;
