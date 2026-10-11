/**
 * Recurring job registration.
 *
 * The schedules live in Redis, not in a cron table on a host, so they survive a
 * restart and do not multiply when a second worker is started — that is the property
 * this file exists for. `upsertJobScheduler` is keyed by the job name, so registering
 * the same schedule on every boot REPLACES it rather than adding another. Without
 * that, a deployment that restarts the worker five times would run the nightly purge
 * five times a night, which is the classic way a scheduled job becomes an incident.
 *
 * Patterns are read in `SCHEDULER_TIMEZONE` (UTC) on purpose. See `constants.ts`: a
 * local-zone cron shifts twice a year, skipping or doubling a daily run. The one job
 * that has to respect local time — `reading-reminder` — reads each user's own wall
 * clock instead.
 */

import type { Queue } from 'bullmq';

import {
  ACCOUNT_ERASURE_CRON,
  JOB_NAMES,
  READING_REMINDER_CRON,
  SCHEDULER_TIMEZONE,
  type JobName,
} from './constants.js';
import type { Logger } from './logger.js';

export interface Schedule {
  readonly name: JobName;
  readonly pattern: string;
}

/**
 * Every recurring job, with the cron it runs on.
 *
 * Exported as data rather than buried in a loop so a test — or a human answering
 * "what does this worker actually do at night" — can read the whole schedule without
 * a Redis connection.
 */
export const SCHEDULES: readonly Schedule[] = [
  { name: JOB_NAMES.accountErasure, pattern: ACCOUNT_ERASURE_CRON },
  { name: JOB_NAMES.readingReminder, pattern: READING_REMINDER_CRON },
];

/**
 * Registers (or re-registers) every schedule. Idempotent.
 *
 * The scheduler id is the job name, which is also the name the worker dispatches on,
 * so there is nothing to keep in sync between this file and `tasks/index.ts`.
 */
export async function registerSchedules(queue: Queue, logger: Logger): Promise<number> {
  for (const schedule of SCHEDULES) {
    await queue.upsertJobScheduler(
      schedule.name,
      { pattern: schedule.pattern, tz: SCHEDULER_TIMEZONE },
      { name: schedule.name },
    );
    logger.debug({ job: schedule.name, pattern: schedule.pattern }, 'schedule registered');
  }

  logger.info(
    { count: SCHEDULES.length, timezone: SCHEDULER_TIMEZONE },
    'recurring jobs registered',
  );
  return SCHEDULES.length;
}

/**
 * Removes schedulers in Redis that no job on this build owns.
 *
 * A renamed or retired job leaves its scheduler behind — Redis keeps producing jobs
 * for a name nothing handles, and they pile up as failures forever. Reconciling on
 * boot means the running code, not the accumulated history of every version that ever
 * connected to this Redis, decides what is scheduled.
 */
export async function pruneOrphanedSchedules(queue: Queue, logger: Logger): Promise<number> {
  const known = new Set<string>(SCHEDULES.map((schedule) => schedule.name));
  // Defaults to the whole range (0, -1), which is what "every scheduler" means here:
  // this queue holds one scheduler per job, so there is no page to walk.
  const existing = await queue.getJobSchedulers();

  let removed = 0;
  for (const scheduler of existing) {
    if (known.has(scheduler.key)) continue;
    await queue.removeJobScheduler(scheduler.key);
    removed += 1;
    logger.warn({ scheduler: scheduler.key }, 'removed orphaned schedule');
  }

  return removed;
}
