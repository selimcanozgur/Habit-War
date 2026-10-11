/**
 * Book routes. Bodies are parsed with Zod so the parsed types flow into the service
 * without a second set of hand-written interfaces.
 */

import type { FastifyInstance } from 'fastify';

import type { BookSearchResult } from '../../lib/book-search.js';

import { BookService } from './service.js';
import {
  bookIdParams,
  createBookBody,
  listBooksQuery,
  searchBooksQuery,
  updateBookBody,
} from './schemas.js';

export interface BookRouteOptions {
  readonly search: (query: string) => Promise<BookSearchResult[]>;
}

/** Search is typed as you go, debounced client-side; 30 a minute is generous for that. */
const SEARCH_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

export async function bookRoutes(app: FastifyInstance, options: BookRouteOptions): Promise<void> {
  const books = new BookService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/books', async (request) => {
    const { status } = listBooksQuery.parse(request.query);
    return { books: await books.list(request.userId, status) };
  });

  /**
   * Best-effort: a provider outage answers with no results rather than an error, so
   * the add-book form falls back to typing the book in by hand.
   */
  app.get('/books/search', { config: { rateLimit: SEARCH_LIMIT } }, async (request) => {
    const { q } = searchBooksQuery.parse(request.query);
    try {
      return { results: await options.search(q) };
    } catch (error) {
      request.log.warn({ err: error }, 'book search failed');
      return { results: [] };
    }
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
