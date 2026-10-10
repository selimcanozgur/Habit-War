/**
 * Every tunable the background jobs have, in one place with its reasoning.
 */

/** BullMQ queue holding every recurring job. */
export const JOBS_QUEUE_NAME = 'habitwar-jobs';

/**
 * The jobs this worker runs. String literals rather than an enum so the values are
 * also the BullMQ job names and the scheduler ids, with nothing to keep in sync.
 */
export const JOB_NAMES = {
  accountErasure: 'account-erasure',
  readingReminder: 'reading-reminder',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Cron patterns are evaluated in UTC: a stable, DST-proof heartbeat. Anything that
 * depends on a user's wall clock is decided per user inside the task.
 */
export const SCHEDULER_TIMEZONE = 'UTC';

/** Nightly, at a quiet hour. */
export const ACCOUNT_ERASURE_CRON = '20 3 * * *';

/**
 * Every 15 minutes. A reminder time is any "HH:MM", so the job must tick often
 * enough that each one falls inside a run's window soon after it passes.
 */
export const READING_REMINDER_CRON = '*/15 * * * *';

// ---------------------------------------------------------------------------
// Account erasure
// ---------------------------------------------------------------------------

/**
 * Days between a deletion request and the hard delete. The API promises the user a
 * `purgeEligibleAt` computed from this, so there must be exactly one copy of it.
 */
export const ACCOUNT_ERASURE_RETENTION_DAYS = 30;

/** Accounts purged per run, each in its own transaction. */
export const ACCOUNT_ERASURE_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Reading reminders
// ---------------------------------------------------------------------------

/**
 * How long after the chosen time a reminder may still go out. Wider than the cron
 * interval so a delayed or retried run still catches it; the per-day claim on the
 * user row keeps the wider window from ever sending twice.
 */
export const REMINDER_WINDOW_MINUTES = 60;

// ---------------------------------------------------------------------------
// BullMQ job options
// ---------------------------------------------------------------------------

/** Attempts per job run before BullMQ marks it failed. */
export const JOB_ATTEMPTS = 3;

/** Exponential backoff starting at 30s: 30s, 60s, 120s. */
export const JOB_BACKOFF_MS = 30_000;

/** Bounded history, so Redis does not accumulate every run forever. */
export const JOB_KEEP_COMPLETED = { age: 7 * 24 * 60 * 60, count: 200 } as const;
export const JOB_KEEP_FAILED = { age: 30 * 24 * 60 * 60, count: 500 } as const;

/** One job at a time: the jobs are small, and serial runs are easier to reason about. */
export const WORKER_CONCURRENCY = 1;

/** How long the worker waits for Redis at boot before exiting non-zero. */
export const REDIS_CONNECT_TIMEOUT_MS = 10_000;

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
