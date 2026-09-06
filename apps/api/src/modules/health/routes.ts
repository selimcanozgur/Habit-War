/**
 * Liveness and readiness.
 *
 * Separate endpoints on purpose: a platform restarting the process because Postgres
 * blipped turns a brief database outage into a full outage.
 */

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.status(503).send({ status: 'degraded', database: 'down' });
    }
  });
}
