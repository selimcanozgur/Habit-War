/**
 * Moderator routes.
 *
 * Every route here sits behind `requireModerator`, which authenticates first and
 * then checks the role — so an anonymous caller gets 401 and a signed-in ordinary
 * user gets 403. The guard is applied once as a plugin-level preHandler rather than
 * per route, because a staff route that someone forgets to guard is the failure mode
 * this whole module exists to prevent.
 */

import type { FastifyInstance } from 'fastify';

import {
  hidePostBody,
  postIdParams,
  queueQuery,
  reportIdParams,
  resolveBody,
  suspendBody,
  userIdParams,
  warnBody,
} from './schemas.js';
import { ModerationService } from './service.js';

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  const moderation = new ModerationService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireModerator);

  app.get('/moderation/reports', async (request) => {
    const query = queueQuery.parse(request.query);
    return moderation.queue({
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });
  });

  app.post('/moderation/reports/:id/claim', async (request) => {
    const { id } = reportIdParams.parse(request.params);
    return { report: await moderation.claim(id, request.userId) };
  });

  app.post('/moderation/reports/:id/dismiss', async (request) => {
    const { id } = reportIdParams.parse(request.params);
    const body = resolveBody.parse(request.body);
    return {
      report: await moderation.dismiss({
        reportId: id,
        moderatorId: request.userId,
        note: body.note,
      }),
    };
  });

  app.post('/moderation/posts/:id/hide', async (request) => {
    const { id } = postIdParams.parse(request.params);
    const body = hidePostBody.parse(request.body);
    return {
      post: await moderation.hidePost({
        postId: id,
        moderatorId: request.userId,
        reason: body.reason,
        reportId: body.reportId,
      }),
    };
  });

  app.post('/moderation/posts/:id/restore', async (request) => {
    const { id } = postIdParams.parse(request.params);
    const body = resolveBody.parse(request.body);
    return { post: await moderation.restorePost(id, request.userId, body.note) };
  });

  app.post('/moderation/users/:id/suspend', async (request) => {
    const { id } = userIdParams.parse(request.params);
    const body = suspendBody.parse(request.body);
    return moderation.suspendUser({
      userId: id,
      moderatorId: request.userId,
      reason: body.reason,
      days: body.days,
      reportId: body.reportId,
    });
  });

  app.post('/moderation/users/:id/reinstate', async (request) => {
    const { id } = userIdParams.parse(request.params);
    const body = resolveBody.parse(request.body);
    return moderation.reinstateUser(id, request.userId, body.note);
  });

  app.post('/moderation/users/:id/warn', async (request) => {
    const { id } = userIdParams.parse(request.params);
    const body = warnBody.parse(request.body);
    return {
      action: await moderation.warnUser(id, request.userId, body.reason, body.reportId),
    };
  });

  app.get('/moderation/users/:id/history', async (request) => {
    const { id } = userIdParams.parse(request.params);
    return moderation.userHistory(id);
  });
}
