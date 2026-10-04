import { describe, expect, it } from 'vitest';

import { DUEL_DRAW_XP, DUEL_PERFECT_XP, DUEL_WIN_XP } from '../balance.js';
import { duelDayIndex, duelLengthDays, duelSettlementReward } from '../duels.js';

const HOUR = 3_600_000;
const start = new Date('2026-10-01T22:00:00Z');
const end = new Date(start.getTime() + 3 * 24 * HOUR);

describe('duelDayIndex', () => {
  it('counts 24-hour slices from acceptance, not calendar days', () => {
    expect(duelDayIndex(start, end, start)).toBe(0);
    // Two hours later is past midnight UTC, but still the duel's first day.
    expect(duelDayIndex(start, end, new Date(start.getTime() + 2 * HOUR))).toBe(0);
    expect(duelDayIndex(start, end, new Date(start.getTime() + 24 * HOUR))).toBe(1);
    expect(duelDayIndex(start, end, new Date(end.getTime() - 1))).toBe(2);
  });

  it('is null outside the window', () => {
    expect(duelDayIndex(start, end, new Date(start.getTime() - 1))).toBeNull();
    expect(duelDayIndex(start, end, end)).toBeNull();
  });
});

describe('duelLengthDays', () => {
  it('reads the length back from the window', () => {
    expect(duelLengthDays(start, end)).toBe(3);
  });
});

describe('duelSettlementReward', () => {
  it('pays the winner, and the perfect bonus for every day done', () => {
    expect(duelSettlementReward({ score: 5, opponentScore: 3, days: 5 })).toEqual({
      win: DUEL_WIN_XP,
      draw: 0,
      perfect: DUEL_PERFECT_XP,
      total: DUEL_WIN_XP + DUEL_PERFECT_XP,
    });
  });

  it('pays a loser no settlement bonus — their per-day XP is already theirs', () => {
    // A loser can never be perfect: every day done means at worst a draw.
    expect(duelSettlementReward({ score: 3, opponentScore: 5, days: 5 }).total).toBe(0);
  });

  it('pays both sides of a draw only when both scored', () => {
    expect(duelSettlementReward({ score: 2, opponentScore: 2, days: 5 }).draw).toBe(DUEL_DRAW_XP);
    expect(duelSettlementReward({ score: 0, opponentScore: 0, days: 5 }).total).toBe(0);
  });

  it('does not pay a win over nobody', () => {
    // A 1-0 win is a real win: one side did the work.
    expect(duelSettlementReward({ score: 1, opponentScore: 0, days: 5 }).win).toBe(DUEL_WIN_XP);
    expect(duelSettlementReward({ score: 0, opponentScore: 0, days: 5 }).win).toBe(0);
  });

  it('gives a perfect draw both bonuses', () => {
    expect(duelSettlementReward({ score: 3, opponentScore: 3, days: 3 }).total).toBe(
      DUEL_DRAW_XP + DUEL_PERFECT_XP,
    );
  });
});
