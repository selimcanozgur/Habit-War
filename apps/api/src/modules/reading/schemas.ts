import { MAX_PAGES_PER_LOG } from '@habitwar/domain';
import { z } from 'zod';

export const logPagesBody = z.object({
  pages: z.number().int().min(1).max(MAX_PAGES_PER_LOG),
  /** Client-generated idempotency key; a retry with the same key logs nothing new. */
  clientRequestId: z.string().min(8).max(100),
  /** What stayed with the reader. Blank is the same as none. */
  note: z
    .string()
    .trim()
    .max(280)
    .nullish()
    .transform((value) => value || null),
});

export const bookIdParams = z.object({ id: z.string().min(1) });
