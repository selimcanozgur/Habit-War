# Habit War

Real habits, tracked against an RPG progression system. Sessions earn XP, XP earns
levels and stats, and everything social sits on top of that.

The product spec lives in [docs/product-spec.md](docs/product-spec.md). Where the code
deviates from it, the deviation is marked in the source and argued in
[docs/adr/](docs/adr/).

---

## Layout

```
habit-war/
├─ docs/
│  ├─ product-spec.md          Original product + technical spec (Turkish)
│  ├─ adr/                     Architecture decision records
│  └─ audit/                   Spec audit findings
├─ infra/
│  └─ docker-compose.yml       Postgres 16 + Redis 7 for local development
├─ packages/
│  └─ domain/                  @habitwar/domain — pure game rules, zero dependencies
├─ apps/
│  └─ api/                     @habitwar/api — Fastify + Prisma
└─ tools/                      Balance simulation and scripts
```

`packages/domain` is the important one. It holds the XP formula, the level curve,
stat/class derivation and streak arithmetic as pure functions: no I/O, no clock
reads, no randomness. The API, the background jobs and eventually the mobile client
all score sessions through the same code, so they cannot disagree about a number.

---

## Getting started

```bash
npm install

# 1. Start Postgres and Redis (needs Docker Desktop running)
npm run db:up

# 2. Create the schema
cd apps/api
npx prisma migrate dev --name init

# 3. Seed a user with two weeks of history
npm run db:seed

# 4. Run the API
npm run dev
```

Then:

```bash
curl localhost:3000/health/ready
curl localhost:3000/v1/habits -H "x-dev-user-id: <id printed by the seed>"
```

### Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Runs every workspace's tests |
| `npm run typecheck` | Type-checks every workspace |
| `npm run build` | Builds every workspace |
| `npm run db:up` / `db:down` | Starts / stops Postgres + Redis |
| `npm run db:logs` | Tails the container logs |

---

## Current state

**Done — Phase 0 foundation**

- `@habitwar/domain`: XP scoring, level curve, stats and classes, streaks. 94 unit tests.
- Prisma schema: `User`, `Habit`, `Session`, `XpLedger`, `DailyUsage`.
- API: habit CRUD, session start/complete/abandon/active, health checks, uniform errors.
- Seed script producing realistic two-week history.
- Verified end to end: migration applied, seed run, session started and completed
  against a live Postgres.

**Not done yet**

- Auth is a development-only header (`x-dev-user-id`). Clerk JWT verification and the
  user-sync webhook are not wired; `src/plugins/auth.ts` refuses to boot in production.
- No social layer, leagues, guilds, or realtime. No mobile app yet.
- No rate limiting and no integration tests against a real database.

---

## Decisions worth knowing before you read the code

The spec was audited before implementation started. Several findings changed the code:

**The level curve was refitted.** The spec's `floor(100 × n^1.6)` put level 50 at
~979,000 XP — around 36 years at the spec's own "60 minutes a day" assumption, against
a stated "~2.5 years". Its own table also disagreed with its own formula. The curve is
now `floor(30 × n^1.15)`, fitted so the spec's *time* targets hold. See
[docs/adr/0001-level-curve.md](docs/adr/0001-level-curve.md).

**Daily caps got a global ceiling.** Seven categories at 120 minutes each is exactly
14 hours, which was also the spec's anomaly threshold — so a user farming every cap
would never have been flagged. Per-category caps now differ and a 6-hour global cap
sits under them.

**Compound multipliers are clamped.** The spec defined modifiers in four different
sections that were never in one formula. Stacked, they reached 5.4x. `TOTAL_MULTIPLIER_CAP`
bounds the compound multiplier at 3.0 so the leaderboard keeps measuring effort.

**XP is an append-only ledger.** The spec stored XP only as a running total, which
makes a wrong award unrecoverable and the "shadow correction" enforcement it describes
impossible to audit. `User.cycleXp` is a cache of `XpLedger`.

**Sessions are idempotent and server-timed.** Duration is computed from
`startedAt`/`endedAt` server-side; `clientRequestId` makes completion safe to retry.
A forgotten timer is auto-abandoned past `MAX_SESSION_MINUTES` instead of blocking the
user's next session forever.

**Stats accumulate XP, not points.** Awarding rounded stat points per session threw
away everything worth less than one point: a 15-minute meditation earns ~18 XP, so
`floor(18 / 20)` is zero and a daily meditator gained 1 WIS in a fortnight. Stats now
store raw XP and the displayed value is derived, so `STAT_POINT_DIVISOR` can be
retuned without migrating data.

**Stats and classes are fully mapped.** The spec had 7 categories, 6 stats and no
mapping between them; it described 4 classes while its enum had 6. Every category now
resolves to a stat, and every stat distribution resolves to a class.

---

## Known issues

`npm audit` reports 3 high-severity advisories in `deepmerge-ts`, reached only through
the Prisma **CLI** (`prisma` → `@prisma/config`). It is a development dependency, not
part of the running server. The fix requires Prisma 8, which is still a release
candidate; revisit when it ships stable.
