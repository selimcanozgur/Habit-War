/**
 * Uniform error serialisation.
 *
 * Every failure leaves the API as `{ error: { code, message, details? } }`. Unknown
 * errors are logged in full but reported opaquely — leaking a stack trace or a
 * Prisma constraint name to a mobile client tells an attacker about the schema.
 */

import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

import { AppError } from '../lib/errors.js';

async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    // Fastify's own schema validation failures arrive as FastifyError with `validation`
    // populated. The instanceof checks above widen `error` to unknown, so narrow it back.
    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: fastifyError.message,
          details: fastifyError.validation,
        },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` },
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
