/**
 * The job name → task map.
 *
 * The one place BullMQ and the tasks meet. `Record<JobName, JobTask>` is exhaustive by
 * type, so adding a name to `JOB_NAMES` without writing its task is a compile error
 * rather than a job that is scheduled, dispatched and then silently unhandled at 03:20
 * in the morning.
 */

import { JOB_NAMES, type JobName } from '../constants.js';
import type { JobTask } from '../context.js';
import { runAccountErasure } from './account-erasure.js';
import { runDuelSettlement } from './duel-settlement.js';
import { runStaleSessionSweep } from './stale-session-sweep.js';
import { runStreakAtRisk } from './streak-at-risk.js';

export const TASKS: Record<JobName, JobTask> = {
  [JOB_NAMES.accountErasure]: runAccountErasure,
  [JOB_NAMES.duelSettlement]: runDuelSettlement,
  [JOB_NAMES.staleSessionSweep]: runStaleSessionSweep,
  [JOB_NAMES.streakAtRisk]: runStreakAtRisk,
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

export { runAccountErasure, runDuelSettlement, runStaleSessionSweep, runStreakAtRisk };
