import { MAX_BOOK_PAGES, MAX_TAKEAWAYS } from '@habitwar/domain';
import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const author = z.string().trim().max(200);
const pageCount = z.number().int().min(1).max(MAX_BOOK_PAGES);
/** Only https: the app loads it as an image, and iOS refuses plain http. */
const coverUrl = z.string().url().max(500).startsWith('https://');

export const createBookBody = z.object({
  title,
  author: author.nullish(),
  pageCount,
  coverUrl: coverUrl.nullish(),
});

export const updateBookBody = z
  .object({
    title: title.optional(),
    author: author.nullish(),
    pageCount: pageCount.optional(),
    coverUrl: coverUrl.nullish(),
    rating: z.number().int().min(1).max(5).nullish(),
    review: z.string().trim().max(280).nullish(),
    takeaways: z.array(z.string().trim().min(1).max(200)).max(MAX_TAKEAWAYS).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

export const listBooksQuery = z.object({
  status: z.enum(['READING', 'FINISHED']).optional(),
});

export const searchBooksQuery = z.object({
  q: z.string().trim().min(2).max(200),
});

export const bookIdParams = z.object({ id: z.string().min(1) });

export type CreateBookInput = z.infer<typeof createBookBody>;
export type UpdateBookInput = z.infer<typeof updateBookBody>;
