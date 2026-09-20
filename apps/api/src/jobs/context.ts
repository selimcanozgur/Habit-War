/**
 * What a task is handed, and what it hands back.
 *
 * The whole point of this type is that a task never reaches for anything global. It
 * gets a database client, an instant and a logger, and it returns numbers. That is
 * what makes every task in `tasks/` callable straight from a test with a real
 * Postgres and no Redis, no BullMQ and no worker process anywhere in sight — the
 * queue is how a task is *triggered*, never part of what it *does*.
 */

import type { PrismaClient } from '@prisma/client';

import type { Logger } from './logger.js';

export interface JobContext {
  readonly prisma: PrismaClient;

  /**
   * The run's instant, FROZEN for the whole run.
   *
   * A `Date`, not a `() => Date` clock like the services use. A sweep must not see
   * time move underneath it: with a live clock, the cutoff used to select rows and
   * the timestamp written onto them can straddle a boundary, so a session picked up
   * as stale gets an `endedAt` from a later moment than the one that qualified it.
   * Worse, the streak job would derive two different local dates for two users in the
   * same batch. One instant per run, decided at the top, makes a run reproducible:
   * given the same database and the same `now`, it does the same thing.
   */
  readonly now: Date;

  /** Already stamped with the job name by the worker. */
  readonly logger: Logger;
}

/**
 * The floor every task's result sits on.
 *
 * `processed` is deliberately the count of rows the run ACTUALLY CHANGED, not the
 * count it looked at: a purge that examined 50 accounts and deleted none is a purge
 * that did nothing, and the log line has to say so. Tasks add their own named counts
 * on top and log them themselves, because "3 accounts purged, 2 reports anonymised"
 * is a sentence only the task knows how to write.
 */
export interface JobOutcome {
  readonly processed: number;
}

export type JobTask = (context: JobContext) => Promise<JobOutcome>;
