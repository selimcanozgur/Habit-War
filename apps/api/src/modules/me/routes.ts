import type { FastifyInstance } from 'fastify';

import { MeService } from './service.js';
import { onboardingBody, pushTokenBody, pushTokenParams, updateMeBody } from './schemas.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  const me = new MeService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/me', async (request) => ({ profile: await me.profile(request.userId) }));

  app.patch('/me', async (request) => {
    const body = updateMeBody.parse(request.body);
    return { profile: await me.update(request.userId, body) };
  });

  app.post('/me/onboarding', async (request) => {
    const body = onboardingBody.parse(request.body);
    return { profile: await me.completeOnboarding(request.userId, body) };
  });

  app.post('/me/push-tokens', async (request, reply) => {
    const body = pushTokenBody.parse(request.body);
    await me.registerPushToken(request.userId, body.token, body.platform);
    return reply.status(204).send();
  });

  app.delete('/me/push-tokens/:token', async (request, reply) => {
    const { token } = pushTokenParams.parse(request.params);
    await me.removePushToken(request.userId, token);
    return reply.status(204).send();
  });

  /**
   * Data portability (KVKK m.11), served as a downloadable attachment: the right is
   * to RECEIVE the data, and a filename is what makes the response portable.
   */
  app.get('/me/export', async (request, reply) => {
    const data = await me.exportData(request.userId);
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="habitwar-export-${stamp}.json"`)
      .header('cache-control', 'no-store')
      .send(data);
  });

  /**
   * Erasure (KVKK m.7). 202, not 204: the account is closed now, but the erasure
   * completes when the purge job runs.
   */
  app.delete('/me', async (request, reply) => {
    const result = await me.requestDeletion(request.userId);
    request.log.info({ userId: request.userId, ...result }, 'account deletion requested');
    return reply.status(202).send(result);
  });
}
