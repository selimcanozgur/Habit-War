/**
 * Book routes. Bodies are parsed with Zod so the parsed types flow into the service
 * without a second set of hand-written interfaces.
 */

import type { FastifyInstance } from 'fastify';

import { BookService } from './service.js';
import { bookIdParams, createBookBody, listBooksQuery, updateBookBody } from './schemas.js';

export async function bookRoutes(app: FastifyInstance): Promise<void> {
  const books = new BookService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/books', async (request) => {
    const { status } = listBooksQuery.parse(request.query);
    return { books: await books.list(request.userId, status) };
  });

  app.post('/books', async (request, reply) => {
    const body = createBookBody.parse(request.body);
    const book = await books.create(request.userId, body);
    return reply.status(201).send({ book });
  });

  app.patch('/books/:id', async (request) => {
    const { id } = bookIdParams.parse(request.params);
    const body = updateBookBody.parse(request.body);
    return { book: await books.update(request.userId, id, body) };
  });

  app.delete('/books/:id', async (request, reply) => {
    const { id } = bookIdParams.parse(request.params);
    await books.remove(request.userId, id);
    return reply.status(204).send();
  });
}
