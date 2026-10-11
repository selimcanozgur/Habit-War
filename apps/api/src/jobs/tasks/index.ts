/**
 * The job name → task map.
 *
 * The one place BullMQ and the tasks meet. `Record<JobName, JobTask>` is exhaustive by
 * type, so adding a name to `JOB_NAMES` without writing its task is a compile error
 * rather than a job that is scheduled, dispatched and then silently unhandled at 03:20
 * in the morning.
 */

import { createExpoClient } from '../../lib/push.js';
import { JOB_NAMES, type JobName } from '../constants.js';
import type { JobTask } from '../context.js';
import { runAccountErasure } from './account-erasure.js';
import { createReadingReminderTask } from './reading-reminder.js';

export const TASKS: Record<JobName, JobTask> = {
  [JOB_NAMES.accountErasure]: runAccountErasure,
  // Only needed when the Expo project has enhanced push security turned on.
  [JOB_NAMES.readingReminder]: createReadingReminderTask(
    createExpoClient(process.env['EXPO_ACCESS_TOKEN']),
  ),
};

/**
 * The task for a job name off the wire, or null.
 *
 * `Job.name` is a `string` — Redis has no idea about our union — so the lookup has to
 * be guarded at runtime. A stale scheduler left over from a renamed job is the real
 * case: it keeps producing jobs nobody handles, and an explicit null lets the worker
 * say so instead of crashing on `undefined is not a function`.
 */
export function taskFor(name: string): JobTask | null {
  return Object.hasOwn(TASKS, name) ? (TASKS[name as JobName] ?? null) : null;
}

export { runAccountErasure };
