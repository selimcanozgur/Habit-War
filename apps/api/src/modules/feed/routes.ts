/**
 * Feed, post, like and reply routes.
 *
 * Bodies and query strings are parsed with Zod rather than Fastify's JSON schema, so
 * the parsed types flow straight into the service without a second, hand-maintained
 * set of interfaces — the same convention the sessions and habits modules follow.
 *
 * Every route here is authenticated. There is no public read path: a feed is a
 * projection of one viewer's social graph and its block list, so "who is asking" is
 * an input to the query, not a decoration on it.
 */

import type { FastifyInstance } from 'fastify';

import { FeedService } from './service.js';
import { createPostBody, createReplyBody, feedQuery, postIdParams, repliesQuery } from './schemas.js';

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  const feed = new FeedService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  /**
   * GET /v1/feed?cursor=&scope=friends|discover&limit=
   *
   * `nextCursor` is opaque and must be echoed back verbatim. There is deliberately no
   * `page` or `offset` parameter — see the cursor discussion in service.ts.
   */
  app.get('/feed', async (request) => {
    const query = feedQuery.parse(request.query);
    return feed.feed({
      userId: request.userId,
      scope: query.scope,
      cursor: query.cursor,
      limit: query.limit,
    });
  });

  app.post('/posts', async (request, reply) => {
    const body = createPostBody.parse(request.body);
    const post = await feed.createPost({
      userId: request.userId,
      type: body.type,
      content: body.content,
      mediaUrls: body.mediaUrls,
    });
    return reply.status(201).send({ post });
  });

  /** Soft delete. Replies survive — the reasoning is in `FeedService.deletePost`. */
  app.delete('/posts/:id', async (request) => {
    const { id } = postIdParams.parse(request.params);
    return { post: await feed.deletePost(request.userId, id) };
  });

  /**
   * Idempotent: liking an already-liked post returns the current state rather than a
   * conflict, so a client that retries a request whose response it never saw
   * converges instead of erroring.
   */
  app.post('/posts/:id/like', async (request) => {
    const { id } = postIdParams.parse(request.params);
    return feed.like(request.userId, id);
  });

  app.delete('/posts/:id/like', async (request) => {
    const { id } = postIdParams.parse(request.params);
    return feed.unlike(request.userId, id);
  });

  /** Oldest first — a thread reads forward. Same opaque cursor contract as the feed. */
  app.get('/posts/:id/replies', async (request) => {
    const { id } = postIdParams.parse(request.params);
    const query = repliesQuery.parse(request.query);
    return feed.replies(request.userId, id, query.cursor, query.limit);
  });

  app.post('/posts/:id/replies', async (request, reply) => {
    const { id } = postIdParams.parse(request.params);
    const body = createReplyBody.parse(request.body);
    const post = await feed.createReply({
      userId: request.userId,
      parentId: id,
      content: body.content,
    });
    return reply.status(201).send({ post });
  });
}
