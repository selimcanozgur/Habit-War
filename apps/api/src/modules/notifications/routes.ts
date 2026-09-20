/**
 * Notification routes.
 *
 * The inbox is per-user by construction: every query is scoped to request.userId,
 * and there is no endpoint that takes someone else's id.
 */

import type { FastifyInstance } from 'fastify';

import {
  listNotificationsQuery,
  notificationIdParams,
  pushTokenParams,
  registerPushTokenBody,
} from './schemas.js';
import { NotificationService } from './service.js';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const notifications = new NotificationService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/notifications', async (request) => {
    const query = listNotificationsQuery.parse(request.query);
    return notifications.list(request.userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    const { id } = notificationIdParams.parse(request.params);
    await notifications.markRead(request.userId, id);
    return reply.status(204).send();
  });

  app.post('/notifications/read-all', async (request) => {
    return notifications.markAllRead(request.userId);
  });

  app.post('/push-tokens', async (request, reply) => {
    const body = registerPushTokenBody.parse(request.body);
    await notifications.registerPushToken({ userId: request.userId, ...body });
    return reply.status(204).send();
  });

  app.delete('/push-tokens/:token', async (request, reply) => {
    const { token } = pushTokenParams.parse(request.params);
    await notifications.removePushToken(request.userId, token);
    return reply.status(204).send();
  });
}
