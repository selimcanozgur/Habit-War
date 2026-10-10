import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ReadingService } from './service.js';
import { bookIdParams, logPagesBody } from './schemas.js';

/** Sixteen weeks: enough for the habit to show, small enough for one phone screen. */
const CALENDAR_DAYS = 112;

const calendarQuery = z.object({
  days: z.coerce.number().int().min(7).max(366).default(CALENDAR_DAYS),
});

export async function readingRoutes(app: FastifyInstance): Promise<void> {
  const reading = new ReadingService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/today', async (request) => reading.today(request.userId));

  app.get('/calendar', async (request) => {
    const { days } = calendarQuery.parse(request.query);
    return reading.calendar(request.userId, days);
  });

  app.get('/books/:id', async (request) => {
    const { id } = bookIdParams.parse(request.params);
    return reading.bookDetail(request.userId, id);
  });

  app.post('/books/:id/logs', async (request, reply) => {
    const { id } = bookIdParams.parse(request.params);
    const body = logPagesBody.parse(request.body);
    const result = await reading.logPages({ userId: request.userId, bookId: id, ...body });
    return reply.status(result.replayed ? 200 : 201).send(result);
  });
}
