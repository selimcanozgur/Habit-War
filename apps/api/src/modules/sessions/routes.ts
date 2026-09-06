/**
 * Session routes.
 *
 * Bodies are parsed with Zod rather than Fastify's JSON schema so the parsed types
 * flow into the service without a second set of hand-written interfaces.
 */

import type { FastifyInstance } from 'fastify';

import { SessionService } from './service.js';
import { completeSessionBody, sessionIdParams, startSessionBody } from './schemas.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  const sessions = new SessionService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.post('/sessions/start', async (request, reply) => {
    const body = startSessionBody.parse(request.body);
    const session = await sessions.start({ userId: request.userId, ...body });
    return reply.status(201).send({ session });
  });

  app.post('/sessions/:id/complete', async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    const body = completeSessionBody.parse(request.body);
    return sessions.complete({
      userId: request.userId,
      sessionId: id,
      clientRequestId: body.clientRequestId,
      interruptions: body.interruptions,
      verification: body.verification,
      proofUrl: body.proofUrl,
    });
  });

  app.post('/sessions/:id/abandon', async (request) => {
    const { id } = sessionIdParams.parse(request.params);
    return { session: await sessions.abandon(request.userId, id) };
  });

  app.get('/sessions/active', async (request) => {
    return { session: await sessions.active(request.userId) };
  });
}
