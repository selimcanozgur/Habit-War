/**
 * Queue definitions and the Redis connection behind them.
 *
 * ONE queue for every recurring job, not one queue per job. The jobs are all
 * low-frequency sweeps with a shared concurrency budget of one (see
 * `WORKER_CONCURRENCY`); four queues would mean four blocking connections and four
 * sets of Redis keys to buy exactly nothing, and BullMQ already separates the jobs by
 * name inside a single queue.
 *
 * REDIS IS OPTIONAL FOR THE API AND MANDATORY FOR THE WORKER. `env.REDIS_URL` is
 * optional because the API serves every request without it — nothing on a request
 * path enqueues anything. The worker is the opposite: with no Redis it has no source
 * of work at all, so it must refuse to start rather than idle convincingly. That
 * asymmetry is why the URL is resolved here, explicitly, instead of being read off a
 * module-level singleton that both processes share.
 */

import { Queue } from 'bullmq';
import type { ConnectionOptions, JobsOptions } from 'bullmq';

import type { Env } from '../env.js';
import {
  JOBS_QUEUE_NAME,
  JOB_ATTEMPTS,
  JOB_BACKOFF_MS,
  JOB_KEEP_COMPLETED,
  JOB_KEEP_FAILED,
  REDIS_CONNECT_TIMEOUT_MS,
} from './constants.js';

/**
 * Raised when the worker is started without a Redis URL.
 *
 * Its own type so `worker.ts` can report a missing configuration as a configuration
 * problem — one clear line and exit 1 — rather than as a stack trace that looks like
 * a crash.
 */
export class MissingRedisUrlError extends Error {
  constructor() {
    super(
      'REDIS_URL is not set. The worker has no queue to read from without it — set ' +
        'REDIS_URL (see infra/docker-compose.yml, `npm run db:up`) or do not start the worker. ' +
        'The API itself does not need Redis and is unaffected.',
    );
    this.name = 'MissingRedisUrlError';
  }
}

/** The Redis URL, or a clear failure. The only place the optionality is resolved. */
export function requireRedisUrl(env: Pick<Env, 'REDIS_URL'>): string {
  if (!env.REDIS_URL) throw new MissingRedisUrlError();
  return env.REDIS_URL;
}

/**
 * ioredis options for every BullMQ connection in this process.
 *
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ, not a preference: a worker
 * blocks on Redis waiting for the next job, and ioredis's default retry ceiling would
 * abort that blocking command and throw a "max retries per request" error at a worker
 * that is behaving perfectly. Null means "keep the command pending across
 * reconnects", which is what a blocking read needs.
 *
 * `connectTimeout` bounds the FIRST connection only; it is what turns an unreachable
 * Redis into a prompt failure instead of a silent reconnect loop.
 */
export function redisConnection(url: string): ConnectionOptions {
  return {
    url,
    maxRetriesPerRequest: null,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  };
}

/**
 * Retry and retention policy for every job on the queue.
 *
 * Safe because every task is idempotent — re-running a purge, a settlement, a sweep
 * or a reminder converges on the same rows rather than doubling anything. Without
 * that property `attempts` would be actively dangerous, which is why each task
 * documents its own idempotency at the top of its file.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_MS },
  removeOnComplete: JOB_KEEP_COMPLETED,
  removeOnFail: JOB_KEEP_FAILED,
};

/**
 * The maintenance queue.
 *
 * The caller owns the returned instance and must `close()` it — a Queue holds an open
 * Redis connection, and a process that forgets one never exits.
 */
export function createJobsQueue(url: string): Queue {
  return new Queue(JOBS_QUEUE_NAME, {
    connection: redisConnection(url),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}
