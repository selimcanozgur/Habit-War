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

import { activeSessionSeconds } from '@habitwar/domain';
import { create } from 'zustand';

/** Foregrounded app repaints. Anything finer than a second is invisible on a clock. */
const TICK_MS = 500;

export interface TimerState {
  readonly sessionId: string | null;
  readonly habitId: string | null;
  /** Epoch ms of the server-recorded start. Null when no session is running. */
  readonly startedAtMs: number | null;
  /** Seconds of resumed pauses, as the server recorded them. */
  readonly pausedSec: number;
  /** Epoch ms the current pause began; null while running. Server-recorded too. */
  readonly pausedAtMs: number | null;
  /** Times the app left the foreground during this session. Feeds focus quality. */
  readonly interruptions: number;
  /** Derived, not accumulated — see the note above. */
  readonly elapsedSec: number;

  /**
   * Adopts a session as the server describes it — on start, on pause and resume, and
   * when the app reopens. Pause state comes from the server, so a session paused
   * yesterday is still paused today, on any device.
   */
  start: (input: {
    sessionId: string;
    habitId: string;
    startedAt: string;
    pausedSec?: number | undefined;
    pausedAt?: string | null | undefined;
  }) => void;
  stop: () => void;
  tick: () => void;
  recordInterruption: () => void;
  /**
   * The VS intro to play before the battle screen. Set by whoever starts a session
   * from a tap — not by `start`, which also adopts a session the server reports, and
   * a reopened app must not replay the intro of a fight already under way.
   */
  readonly introPending: boolean;
  requestIntro: () => void;
  clearIntro: () => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  sessionId: null,
  habitId: null,
  startedAtMs: null,
  pausedSec: 0,
  pausedAtMs: null,
  interruptions: 0,
  elapsedSec: 0,
  introPending: false,

  start: ({ sessionId, habitId, startedAt, pausedSec = 0, pausedAt = null }) => {
    const startedAtMs = Date.parse(startedAt);
    const pausedAtMs = pausedAt ? Date.parse(pausedAt) : null;
    set((state) => ({
      sessionId,
      habitId,
      startedAtMs,
      pausedSec,
      pausedAtMs,
      // A re-sync of the same session keeps the interruptions counted so far.
      interruptions: state.sessionId === sessionId ? state.interruptions : 0,
      elapsedSec: elapsedFrom(startedAtMs, pausedSec, pausedAtMs),
    }));
  },

  stop: () =>
    set({
      sessionId: null,
      habitId: null,
      startedAtMs: null,
      pausedSec: 0,
      pausedAtMs: null,
      elapsedSec: 0,
      interruptions: 0,
    }),

  tick: () => {
    const { startedAtMs, pausedSec, pausedAtMs } = get();
    if (startedAtMs === null) return;
    set({ elapsedSec: elapsedFrom(startedAtMs, pausedSec, pausedAtMs) });
  },

  recordInterruption: () => set((state) => ({ interruptions: state.interruptions + 1 })),
  requestIntro: () => set({ introPending: true }),
  clearIntro: () => set({ introPending: false }),
}));

/**
 * Credited seconds so far — the same arithmetic the server awards on, from the domain
 * package. Floored at zero because the device clock can sit behind the server's.
 */
function elapsedFrom(startedAtMs: number, pausedSec: number, pausedAtMs: number | null): number {
  return activeSessionSeconds(
    {
      startedAt: new Date(startedAtMs),
      pausedSec,
      pausedAt: pausedAtMs === null ? null : new Date(pausedAtMs),
    },
    new Date(),
  );
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
