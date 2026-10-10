import { MAX_BOOK_PAGES } from '@habitwar/domain';
import { z } from 'zod';

const title = z.string().trim().min(1).max(200);
const author = z.string().trim().max(200);
const pageCount = z.number().int().min(1).max(MAX_BOOK_PAGES);

export const createBookBody = z.object({
  title,
  author: author.nullish(),
  pageCount,
});

export const updateBookBody = z
  .object({
    title: title.optional(),
    author: author.nullish(),
    pageCount: pageCount.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update',
  });

export const listBooksQuery = z.object({
  status: z.enum(['READING', 'FINISHED']).optional(),
});

export const bookIdParams = z.object({ id: z.string().min(1) });

export type CreateBookInput = z.infer<typeof createBookBody>;
export type UpdateBookInput = z.infer<typeof updateBookBody>;
