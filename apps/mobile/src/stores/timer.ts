/**
 * Timer state.
 *
 * THE IMPORTANT IDEA: this client does not count seconds. It stores the session's
 * `startedAt` and derives elapsed time from the wall clock on every tick.
 *
 * The audit flagged that the spec never designed for a 30-120 minute timer surviving
 * backgrounding, and proposed per-second WebSocket ticks — which is exactly the
 * approach that cannot work. iOS suspends JavaScript timers in the background and
 * Android's Doze does the same, so an incrementing counter would silently stop and
 * under-report the session. Deriving from `startedAt` means a backgrounded app
 * simply renders the right number the instant it resumes, and the interval below is
 * only there to repaint.
 *
 * The number that actually counts is the server's: it recomputes duration from
 * startedAt/endedAt when the session completes. Everything here is display.
 */

import { create } from 'zustand';

/** Foregrounded app repaints. Anything finer than a second is invisible on a clock. */
const TICK_MS = 500;

export interface TimerState {
  readonly sessionId: string | null;
  readonly habitId: string | null;
  /** Epoch ms of the server-recorded start. Null when no session is running. */
  readonly startedAtMs: number | null;
  /** Times the app left the foreground during this session. Feeds focus quality. */
  readonly interruptions: number;
  /** Derived, not accumulated — see the note above. */
  readonly elapsedSec: number;

  start: (input: { sessionId: string; habitId: string; startedAt: string }) => void;
  stop: () => void;
  tick: () => void;
  recordInterruption: () => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  sessionId: null,
  habitId: null,
  startedAtMs: null,
  interruptions: 0,
  elapsedSec: 0,

  start: ({ sessionId, habitId, startedAt }) => {
    const startedAtMs = Date.parse(startedAt);
    set({
      sessionId,
      habitId,
      startedAtMs,
      interruptions: 0,
      elapsedSec: elapsedFrom(startedAtMs),
    });
  },

  stop: () => set({ sessionId: null, habitId: null, startedAtMs: null, elapsedSec: 0, interruptions: 0 }),

  tick: () => {
    const { startedAtMs } = get();
    if (startedAtMs === null) return;
    set({ elapsedSec: elapsedFrom(startedAtMs) });
  },

  recordInterruption: () => set((state) => ({ interruptions: state.interruptions + 1 })),
}));

/**
 * Seconds since `startedAtMs`, floored at zero.
 *
 * Clamped because the device clock can sit behind the server's, which would
 * otherwise render a negative timer for the first few seconds of a session.
 */
function elapsedFrom(startedAtMs: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

export { TICK_MS };

/** mm:ss, or h:mm:ss once a session passes an hour. */
export function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
