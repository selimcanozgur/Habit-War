/**
 * Every tunable the background jobs have, in one place with its reasoning.
 *
 * Schedules and retention windows are the settings most likely to be changed under
 * pressure ("the purge is too slow", "duels settle too late"). Scattered across four
 * task files they drift out of sync with the comments that justify them, so they all
 * live here and every task imports from here.
 *
 * Two constants are deliberately NOT redefined here and are imported from the module
 * that owns the rule instead:
 *
 *  - `ACCOUNT_ERASURE_RETENTION_DAYS` from `modules/safety/service.ts`. The API
 *    already promises the user a `purgeEligibleAt` computed from it; a second copy
 *    here is how the promise and the purge start disagreeing.
 *  - `MAX_SESSION_MINUTES` from `@habitwar/domain`. It is the same rule the XP engine
 *    uses to decide what is creditable, and the sweep exists to enforce exactly that
 *    boundary.
 */

/** BullMQ queue holding every recurring maintenance job. */
export const JOBS_QUEUE_NAME = 'habitwar-jobs';

/**
 * The jobs this worker runs. String literals rather than an enum so the values are
 * also the BullMQ job names and the scheduler ids, with nothing to keep in sync.
 */
export const JOB_NAMES = {
  accountErasure: 'account-erasure',
  duelSettlement: 'duel-settlement',
  staleSessionSweep: 'stale-session-sweep',
  streakAtRisk: 'streak-at-risk',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Cron patterns are interpreted in this timezone.
 *
 * UTC, not a local zone, so the schedule does not silently shift twice a year when
 * the server's region changes clocks — a DST jump would either skip a daily run or
 * run it twice. The one job that genuinely cares about local time (streak-at-risk)
 * derives the user's own local hour instead of leaning on the cron timezone.
 */
export const SCHEDULER_TIMEZONE = 'UTC';

/**
 * Daily at 03:20 UTC. Off the hour on purpose: every other system in a deployment
 * also fires at :00, and a purge that competes with backups for the same I/O window
 * is a purge that times out.
 */
export const ACCOUNT_ERASURE_CRON = '20 3 * * *';

/**
 * Hourly at :05. A duel's result is not time-critical to the minute, and a loser who
 * is told an hour late is far better off than one who is never told because both
 * players stopped opening the app.
 */
export const DUEL_SETTLEMENT_CRON = '5 * * * *';

/**
 * Every 15 minutes. `MAX_SESSION_MINUTES` is 240, so the practical worst case is a
 * forgotten timer that stays ACTIVE for 4h15m rather than 4h. Sweeping more often
 * buys nothing — the session was already uncreditable at the 4h mark — and sweeping
 * less often extends the window in which the user cannot start a new session.
 */
export const STALE_SESSION_SWEEP_CRON = '*/15 * * * *';

/**
 * Hourly, on the hour. The job itself is DAILY per user: it fires every hour and
 * selects only the users whose LOCAL clock has just reached
 * `STREAK_REMINDER_LOCAL_HOUR`. See `tasks/streak-at-risk.ts` for why a single daily
 * UTC run cannot work.
 */
export const STREAK_AT_RISK_CRON = '0 * * * *';

// ---------------------------------------------------------------------------
// Streak reminders
// ---------------------------------------------------------------------------

/**
 * The hour, in the USER'S OWN timezone, at which a streak warning is sent.
 *
 * 20:00 local: late enough that "you have not logged anything today" is true rather
 * than premature, early enough that a 15-minute session still fits before local
 * midnight. A warning at 23:00 is an accusation, not a reminder.
 */
export const STREAK_REMINDER_LOCAL_HOUR = 20;

/**
 * Streaks shorter than this are not worth a notification.
 *
 * One or two days is not yet a habit, and warning about it is precisely the
 * notification spam the spec's 3-per-day cap exists to prevent. Three consecutive
 * days is the first point at which the user has something they would be annoyed to
 * lose.
 */
export const STREAK_AT_RISK_MIN_DAYS = 3;

/**
 * How far back the job looks for an existing warning before sending another.
 *
 * 23 hours, not 24. The previous send was a local day ago, which is 23, 24 or 25
 * hours depending on whether a DST transition fell in between; a strict 24-hour
 * window would suppress a legitimate reminder on the day the clocks go forward. 23
 * is comfortably longer than the one-hour gap between two ticks of the hourly
 * schedule, so a retry inside the same hour is still deduplicated.
 */
export const STREAK_AT_RISK_DEDUPE_WINDOW_HOURS = 23;

// ---------------------------------------------------------------------------
// Batch sizes
// ---------------------------------------------------------------------------

/**
 * Accounts hard-deleted per run.
 *
 * Each purge is a transaction that cascades across a user's whole history, so the
 * cost per row is large and unpredictable. 50 a day clears any realistic backlog
 * within days while keeping every individual transaction short enough that it cannot
 * hold locks against live traffic. The job is idempotent, so a backlog simply carries
 * to tomorrow.
 */
export const ACCOUNT_ERASURE_BATCH_SIZE = 50;

/**
 * Duels settled per run. Each one costs two aggregate queries over XpLedger, so the
 * bound keeps a backlog from turning one hourly tick into a long-running scan.
 */
export const DUEL_SETTLEMENT_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// BullMQ job options
// ---------------------------------------------------------------------------

/**
 * Retries per run. Every task is idempotent, so a retry is safe; three attempts
 * cover a transient database blip without hammering a database that is genuinely
 * down.
 */
export const JOB_ATTEMPTS = 3;

/** Exponential backoff starting at 30s: 30s, 60s, 120s. */
export const JOB_BACKOFF_MS = 30_000;

/**
 * History kept in Redis. Enough to answer "did last night's purge run and what did it
 * do" without letting the queue's key space grow without bound.
 */
export const JOB_KEEP_COMPLETED = { age: 7 * 24 * 60 * 60, count: 200 } as const;
export const JOB_KEEP_FAILED = { age: 30 * 24 * 60 * 60, count: 500 } as const;

/**
 * One job at a time.
 *
 * Every task here is a sweep over a whole table. Running two concurrently wins no
 * wall-clock time (they contend on the same rows) and turns a single predictable
 * database load into an unpredictable one.
 */
export const WORKER_CONCURRENCY = 1;

/**
 * How long the worker waits for Redis at boot before giving up and exiting non-zero.
 *
 * A worker that hangs forever on an unreachable Redis looks alive to a process
 * supervisor and to a human reading `ps`, while running nothing at all. Failing
 * loudly is the whole point.
 */
export const REDIS_CONNECT_TIMEOUT_MS = 10_000;

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
