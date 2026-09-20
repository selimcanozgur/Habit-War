import { z } from 'zod';

import { MAX_SUSPENSION_DAYS } from './service.js';

/**
 * Every enforcement endpoint requires a written reason.
 *
 * Not a formality: the reason is what the author is shown, what an appeal is judged
 * against, and what a store or regulator asks to see. A minimum length keeps "spam"
 * from being the whole record of a decision.
 */
const reason = z.string().trim().min(10).max(1000);

export const queueQuery = z.object({
  status: z.enum(['PENDING', 'UNDER_REVIEW', 'ACTION_TAKEN', 'DISMISSED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
});

export const reportIdParams = z.object({ id: z.string().cuid() });
export const postIdParams = z.object({ id: z.string().cuid() });
export const userIdParams = z.object({ id: z.string().cuid() });

export const resolveBody = z.object({ note: reason });

export const hidePostBody = z.object({
  reason,
  /** Links the action to the report that prompted it, and resolves that report. */
  reportId: z.string().cuid().optional(),
});

export const suspendBody = z.object({
  reason,
  days: z.number().int().min(1).max(MAX_SUSPENSION_DAYS),
  reportId: z.string().cuid().optional(),
});

export const warnBody = z.object({
  reason,
  reportId: z.string().cuid().optional(),
});
