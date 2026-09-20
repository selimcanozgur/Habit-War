/**
 * Seasons — the source of the XP engine's `eventMultiplier`.
 *
 * `@habitwar/domain`'s `calculateSessionXp` takes `eventMultiplier` as an input and
 * documents that it "comes from the SERVER, never the client", but Phase 0 had
 * nowhere to store it and the session path passes a hardcoded 1. `Season` is that
 * store, and `resolveEventMultiplier` is the one function the write path should call.
 *
 * Two rules this module owns:
 *
 *  1. "The season in effect right now" is `isActive AND startsAt <= now < endsAt`.
 *     End is exclusive so two back-to-back seasons that share a boundary instant
 *     cannot both be active for one millisecond.
 *  2. No active season is NOT an error. It is the ordinary state between seasons,
 *     and it resolves to the neutral multiplier 1.0. Throwing here would take the
 *     whole session-completion path down every time a season lapses.
 */

import type { PrismaClient, Season } from '@prisma/client';
import { EVENT_MULTIPLIER_MAX, EVENT_MULTIPLIER_MIN } from '@habitwar/domain';

/** Injectable clock, matching the convention in `modules/sessions/service.ts`. */
export type Clock = () => Date;

export interface SeasonServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

export interface CurrentSeasonView {
  readonly season: SeasonSummary | null;
  /** Already clamped. This is the value the scoring path should use verbatim. */
  readonly eventMultiplier: number;
}

export interface SeasonSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly theme: string;
  readonly description: string | null;
  readonly bannerUrl: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The clamped value, not the raw column — clients must not see an unenforceable number. */
  readonly eventMultiplier: number;
  /** Whole days left, floored. Zero on the final day. */
  readonly daysRemaining: number;
}

/**
 * Clamps a raw `Season.eventMultiplier` into the domain's allowed band.
 *
 * The column is a plain Float with no database-level check, so an operator typo
 * ("10" instead of "1.0") would otherwise multiply every award in the system by ten.
 * The bounds are the domain constants, never literals here: retuning the economy
 * must stay a one-file change in `packages/domain/src/balance.ts`.
 *
 * A non-finite value (NaN from a bad import) degrades to the minimum rather than
 * poisoning the arithmetic downstream.
 */
export function clampEventMultiplier(raw: number): number {
  if (!Number.isFinite(raw)) return EVENT_MULTIPLIER_MIN;
  return Math.min(EVENT_MULTIPLIER_MAX, Math.max(EVENT_MULTIPLIER_MIN, raw));
}

export class SeasonService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: SeasonServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  /**
   * The season in effect right now, or null between seasons.
   *
   * Ordered by `startsAt` descending so that overlapping seasons — which the schema
   * permits and only operator discipline prevents — resolve deterministically to the
   * most recently started one instead of to whatever the planner happened to return.
   */
  async findActive(): Promise<Season | null> {
    const now = this.#now();
    return this.#prisma.season.findFirst({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  /**
   * The multiplier the scoring path should pass to `calculateSessionXp`.
   * Returns EVENT_MULTIPLIER_MIN (1.0) when no season is running.
   */
  async resolveEventMultiplier(): Promise<number> {
    const season = await this.findActive();
    if (!season) return EVENT_MULTIPLIER_MIN;
    return clampEventMultiplier(season.eventMultiplier);
  }

  /** GET /v1/seasons/current. */
  async current(): Promise<CurrentSeasonView> {
    const season = await this.findActive();
    if (!season) {
      return { season: null, eventMultiplier: EVENT_MULTIPLIER_MIN };
    }
    const eventMultiplier = clampEventMultiplier(season.eventMultiplier);
    return {
      season: this.#summarise(season, eventMultiplier),
      eventMultiplier,
    };
  }

  #summarise(season: Season, eventMultiplier: number): SeasonSummary {
    const msRemaining = season.endsAt.getTime() - this.#now().getTime();
    return {
      id: season.id,
      code: season.code,
      name: season.name,
      theme: season.theme,
      description: season.description,
      bannerUrl: season.bannerUrl,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      eventMultiplier,
      daysRemaining: Math.max(0, Math.floor(msRemaining / 86_400_000)),
    };
  }
}

/**
 * Standalone helper for callers that hold a PrismaClient but no service instance —
 * the session write path and background jobs. Same rules, same clamp.
 */
export async function resolveEventMultiplier(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  return new SeasonService({ prisma, now: () => now }).resolveEventMultiplier();
}
