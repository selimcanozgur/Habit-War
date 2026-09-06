# ADR 0001 — Refit the level curve to the spec's time targets

**Status:** Accepted
**Date:** 2026-09-06
**Affects:** `packages/domain/src/balance.ts`, `packages/domain/src/leveling.ts`

## Context

The product spec (§3.2) defines the level curve as:

```
requiredXp(n) = floor(100 × n^1.6)
```

and presents this table:

| Level | Required XP | Cumulative XP | Approx. time |
|---|---|---|---|
| 1 → 2 | 100 | 100 | ~2 days |
| 5 → 6 | 1,174 | ~2,900 | ~1 week |
| 10 → 11 | 3,981 | ~15,800 | ~1 month |
| 25 → 26 | 17,099 | ~150,000 | ~6 months |
| 50 → 51 | 51,800 | ~900,000 | ~2.5 years |

with the footnote "assuming ~60 min of active habit per day".

Three separate problems:

**1. The table disagrees with its own formula.**

| Level | Table says | `floor(100 × n^1.6)` actually gives |
|---|---|---|
| 5 → 6 | 1,174 | **1,313** |
| 10 → 11 | 3,981 | 3,981 ✓ |
| 25 → 26 | 17,099 | **17,246** |
| 50 → 51 | 51,800 | **52,281** |

The cumulative column is further off: it lists ~15,800 to reach level 11 where the
formula sums to 17,349, and ~150,000 for level 26 against an actual 174,535.

**2. The time column is off by an order of magnitude.**

Reaching level 50 requires ~979,000 XP. At the spec's own 60 minutes per day — 60 base
XP, before multipliers — that is 16,323 days, or **44.7 years**. Even assuming an
optimistic sustained 2× average multiplier it is 22 years. The spec says 2.5 years.

This is not a rounding error. It is the difference between a progression system a
person can actually complete and one that is decorative.

**3. A single power curve cannot satisfy all the stated targets.**

Treating the time column as the requirement and fitting `A × n^p` to it:

- level 51 / level 26 ratio implies `p ≈ 1.33`
- level 26 / level 11 ratio implies `p ≈ 0.97`

No single exponent hits both. The "~2 days to level 2" anchor is more inconsistent
still: it demands the first level cost more XP than each of the next four, which no
increasing curve can do.

## Decision

Treat the spec's **time targets** as the requirement and fit the curve to them,
rather than preserving a formula whose output contradicts its own stated intent.

```
requiredXp(n) = floor(30 × n^1.15)
```

Fitted by minimising squared log-error against the three long-range anchors (levels
11, 26 and 50) at a reference rate of 75 XP/day — 60 minutes at an average total
multiplier of 1.25.

Resulting calibration:

| Target | Spec intent | This curve |
|---|---|---|
| Level 2 | ~2 days | 30 XP — inside the first session |
| Level 11 | ~1 month | 29 days |
| Level 26 | ~6 months | 196 days |
| Level 50 | ~2.5 years | 818 days (2.24 years) |

The "~2 days to level 2" anchor was deliberately dropped. Reaching level 2 in the
first session is better onboarding than making a new user wait two days for the first
reward, and it is the only way to keep the curve monotonic.

These targets are locked as assertions in `leveling.test.ts`, so retuning
`LEVEL_BASE` or `LEVEL_EXPONENT` without revisiting the time targets fails the build.

## Consequences

**The base XP value is lower than the spec's.** Level 1 → 2 costs 30 XP rather than
100. Absolute XP numbers therefore look smaller than the spec's examples. This is
cosmetic: XP has no meaning except relative to the curve.

**The curve is flatter.** `n^1.15` grows more slowly than `n^1.6`, so late levels are
less punishing relative to early ones. Level 50 → 51 costs 2,699 XP, about 90× the
first level, versus 522× in the spec's curve. A 522× ramp is what pushed level 50 out
to decades.

**Retuning is a one-line change.** Both parameters live in `balance.ts`, the curve is
expanded into a lookup table at module load, and `daysToReachLevel()` exists so the
balance simulator and the tests can check any candidate against the time targets.

**Level 50 remains a multi-year goal.** Prestige/Ascend at level 50 is a long-tail
mechanic, not something most users will reach. That matches the spec's intent; it
simply now matches its arithmetic too.

## Alternatives considered

**Keep `100 × n^1.6` and raise XP per day.** Would need ~1,070 XP/day to hit 2.5
years — roughly 14 hours of daily activity at full multipliers. Incompatible with a
habit tracker.

**Keep the formula and restate the time column honestly.** "Level 50: ~36 years" is
accurate but makes the top half of the progression system dead content.

**Piecewise curve — fast early, steep late.** Hits every anchor including the 2-day
one, but adds a second set of tuning parameters and a discontinuity to explain. Not
worth it before there is a single real user to tune against.
