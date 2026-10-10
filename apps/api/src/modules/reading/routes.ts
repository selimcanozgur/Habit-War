import type { FastifyInstance } from 'fastify';

import { ReadingService } from './service.js';
import { bookIdParams, logPagesBody } from './schemas.js';

export async function readingRoutes(app: FastifyInstance): Promise<void> {
  const reading = new ReadingService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/today', async (request) => reading.today(request.userId));

  app.post('/books/:id/logs', async (request, reply) => {
    const { id } = bookIdParams.parse(request.params);
    const body = logPagesBody.parse(request.body);
    const result = await reading.logPages({ userId: request.userId, bookId: id, ...body });
    return reply.status(result.replayed ? 200 : 201).send(result);
  });
}
