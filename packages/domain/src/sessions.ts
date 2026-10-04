/**
 * Session time with pauses.
 *
 * A session's credited time is wall time since it started, minus every completed
 * pause, minus the pause still running if it is paused now. Pure and shared, so the
 * server's award and the client's readout are the same number.
 */

export interface SessionClock {
  readonly startedAt: Date;
  /** Seconds of pauses already resumed. */
  readonly pausedSec: number;
  /** Set while paused. */
  readonly pausedAt: Date | null;
}

/** Active (credited) seconds of a session at `at`, floored at zero. */
export function activeSessionSeconds(clock: SessionClock, at: Date): number {
  const end = clock.pausedAt !== null && clock.pausedAt < at ? clock.pausedAt : at;
  const wall = Math.floor((end.getTime() - clock.startedAt.getTime()) / 1000);
  return Math.max(0, wall - Math.max(0, clock.pausedSec));
}
