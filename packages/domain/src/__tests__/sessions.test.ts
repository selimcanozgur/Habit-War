import { describe, expect, it } from 'vitest';

import { activeSessionSeconds } from '../sessions.js';

const start = new Date('2024-06-01T09:00:00Z');
const at = (sec: number): Date => new Date(start.getTime() + sec * 1000);

describe('activeSessionSeconds', () => {
  it('is wall time when never paused', () => {
    expect(activeSessionSeconds({ startedAt: start, pausedSec: 0, pausedAt: null }, at(600))).toBe(600);
  });

  it('subtracts resumed pauses', () => {
    expect(activeSessionSeconds({ startedAt: start, pausedSec: 120, pausedAt: null }, at(600))).toBe(480);
  });

  it('freezes while paused', () => {
    const clock = { startedAt: start, pausedSec: 60, pausedAt: at(300) };
    expect(activeSessionSeconds(clock, at(300))).toBe(240);
    expect(activeSessionSeconds(clock, at(5000))).toBe(240);
  });

  it('never goes negative', () => {
    expect(activeSessionSeconds({ startedAt: start, pausedSec: 999, pausedAt: null }, at(10))).toBe(0);
  });
});
