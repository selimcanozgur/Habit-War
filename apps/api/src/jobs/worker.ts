/**
 * Worker process entry point.
 *
 * A SEPARATE PROCESS from the API, not a plugin inside it. Three reasons, in order of
 * how much they hurt when ignored:
 *
 *  1. A sweep over a whole table competes with request handling for the same event
 *     loop. An API that stalls for the duration of the nightly purge is an API with a
 *     nightly outage.
 *  2. The API runs as N replicas behind a load balancer. A job inside it runs N
 *     times, and "purge every expired account" running four times concurrently is a
 *     different program from the one that was tested.
 *  3. They fail differently. The worker may be restarted, scaled to zero or left down
 *     during an incident without touching request serving, and this file exits
 *     non-zero when it cannot work — which a process supervisor can act on.
 *
 * REDIS IS MANDATORY HERE AND OPTIONAL FOR THE API. Without it this process has no
 * source of work, so it says so on one line and exits 1 rather than idling while
 * looking perfectly healthy in `ps`. The API keeps serving every request without
 * Redis; nothing on a request path enqueues anything.
 *
 * Shutdown mirrors `main.ts`: SIGTERM/SIGINT once, drain, exit 0, and exit 1 if the
 * drain itself fails. `Worker.close()` waits for the job in flight to finish, which is
 * what keeps a deploy from cutting a purge transaction in half.
 */

import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';

import { loadWorkerEnv } from '../env.js';
import { JOBS_QUEUE_NAME, REDIS_CONNECT_TIMEOUT_MS, WORKER_CONCURRENCY } from './constants.js';
import { createLogger, type Logger } from './logger.js';
import { createJobsQueue, MissingRedisUrlError, redisConnection, requireRedisUrl } from './queues.js';
import { pruneOrphanedSchedules, registerSchedules } from './scheduler.js';
import { taskFor } from './tasks/index.js';

/**
 * Fails a promise that is taking too long.
 *
 * Needed because BullMQ's connections are configured with `maxRetriesPerRequest: null`
 * — mandatory for blocking reads — which also means ioredis retries a connection
 * forever. `waitUntilReady()` against an unreachable Redis therefore never settles,
 * and "hangs silently" is the exact failure this process is written to avoid.
 * `unref` so the timer cannot hold the process open on the happy path.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  // Worker-scoped config: this process authenticates nobody, so it is not given
  // the API's auth credentials. See loadWorkerEnv.
  const env = loadWorkerEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, name: 'habitwar-worker' });

  const redisUrl = requireRedisUrl(env);
  const prisma = new PrismaClient();
  const queue = createJobsQueue(redisUrl);

  const worker = new Worker(
    JOBS_QUEUE_NAME,
    async (job: Job) => {
      const task = taskFor(job.name);
      if (!task) {
        // Thrown rather than ignored: an unknown name means a scheduler in Redis has
        // outlived the code that handled it, and a job quietly succeeding without
        // doing anything is how that stays invisible.
        throw new Error(`No task registered for job "${job.name}"`);
      }

      const jobLogger: Logger = logger.child({ job: job.name, jobId: job.id ?? null });
      const startedAt = Date.now();
      jobLogger.info({ attempt: job.attemptsMade + 1 }, 'job started');

      // One frozen instant per run — see JobContext.now for why the tasks are handed
      // a Date and not a clock function.
      const result = await task({ prisma, now: new Date(), logger: jobLogger });

      jobLogger.info(
        { processed: result.processed, durationMs: Date.now() - startedAt },
        'job finished',
      );
      return result;
    },
    {
      connection: redisConnection(redisUrl),
      concurrency: WORKER_CONCURRENCY,
    },
  );

  // BullMQ surfaces connection trouble as an 'error' event. An EventEmitter with no
  // 'error' listener throws, so an unhandled Redis blip would take the process down
  // instead of letting ioredis reconnect.
  worker.on('error', (error) => logger.error({ err: error }, 'worker error'));
  queue.on('error', (error) => logger.error({ err: error }, 'queue error'));

  worker.on('failed', (job, error) => {
    logger.error(
      { job: job?.name ?? null, jobId: job?.id ?? null, attempt: job?.attemptsMade ?? null, err: error },
      'job failed',
    );
  });

  await withTimeout(
    worker.waitUntilReady(),
    REDIS_CONNECT_TIMEOUT_MS,
    `Redis did not become ready within ${REDIS_CONNECT_TIMEOUT_MS}ms (REDIS_URL=${redisUrl})`,
  );

  await pruneOrphanedSchedules(queue, logger);
  await registerSchedules(queue, logger);

  logger.info(
    { queue: JOBS_QUEUE_NAME, concurrency: WORKER_CONCURRENCY },
    'worker ready',
  );

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'shutting down');

      // Order matters: stop taking work and let the in-flight job finish, then release
      // the queue's connection, then the database. Disconnecting Prisma first would
      // fail the job that is currently running.
      void (async () => {
        await worker.close();
        await queue.close();
        await prisma.$disconnect();
      })().then(
        () => process.exit(0),
        (error: unknown) => {
          logger.error({ err: error }, 'error during shutdown');
          process.exit(1);
        },
      );
    });
  }
}

main().catch((error: unknown) => {
  if (error instanceof MissingRedisUrlError) {
    // A configuration problem, reported as one: a stack trace here would read like a
    // crash and send somebody looking for a bug that is not there.
    console.error(`Worker cannot start: ${error.message}`);
    process.exit(1);
  }
  console.error('Failed to start worker:', error);
  process.exit(1);
});
