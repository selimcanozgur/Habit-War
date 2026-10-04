/**
 * Session request/response contracts.
 *
 * Note what is absent: the client never sends a duration. It is derived server-side
 * from startedAt/endedAt, because a client-supplied duration is the single easiest
 * way to mint XP out of nothing.
 */

import { z } from 'zod';

/** Idempotency key. Must be stable across retries of the same logical request. */
const clientRequestId = z.string().min(8).max(64);

export const startSessionBody = z.object({
  habitId: z.string().cuid(),
  clientRequestId,
});

export const completeSessionBody = z.object({
  clientRequestId,
  /** Interruption count observed by the client; bounded so it cannot be used as a lever. */
  interruptions: z.number().int().min(0).max(1000).default(0),
  verification: z
    .enum(['MANUAL_ENTRY', 'TIMER_ONLY', 'HEALTH_DATA', 'PHOTO_PROOF', 'PEER_VERIFIED'])
    .default('TIMER_ONLY'),
  proofUrl: z.string().url().max(500).optional(),
});

export const sessionIdParams = z.object({ id: z.string().cuid() });

/** A count habit's quick log: how many, plus the idempotency key every write carries. */
export const logCountBody = z.object({
  clientRequestId,
  count: z.number().int().min(1).max(1000),
});

export const habitIdParams = z.object({ id: z.string().cuid() });

export type StartSessionBody = z.infer<typeof startSessionBody>;
export type CompleteSessionBody = z.infer<typeof completeSessionBody>;
