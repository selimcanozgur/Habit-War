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
│  ├─ api/                     @habitwar/api — Fastify + Prisma
│  └─ mobile/                  @habitwar/mobile — Expo + expo-router
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
curl localhost:3000/v1/habits -H "x-dev-user-id: <id printed by the seed>"   # AUTH_MODE=dev
curl localhost:3000/v1/habits -H "authorization: Bearer <clerk session jwt>"   # AUTH_MODE=clerk
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

**Working end to end**

- `@habitwar/domain`: XP scoring, level curve, stats and classes, streaks. 94 unit tests.
- 19 Prisma models. Habits and sessions, the XP ledger, the social graph, posts and
  likes, duels, achievements, seasons, the moderation/consent tables and the
  append-only enforcement trail.
- ~65 endpoints across ten modules. 172 API tests, including route-registration,
  client-contract, moderation, rate-limit and notification suites.
- Rate limiting keyed on the caller's credential (not IP — one university NAT must
  not share one budget), with per-route budgets sized for human behaviour.
- Notifications for every event that concerns another person, plus Expo push delivery
  enforcing the spec's 3-per-day cap.
- Moderator tooling: a report queue worked oldest-first, post hiding and restoring,
  bounded account suspension, warnings, and an append-only audit trail. Staff routes
  sit behind a role guard; the seed ships a moderator account.
- Clerk auth: JWT verification, just-in-time provisioning, signature-verified webhook.
- Background jobs, in a separate worker process (`cd apps/api && npm run worker`):
  the KVKK account-erasure purge, duel settlement for duels nobody opened, the stale
  session sweep, and streak-at-risk reminders sent at each user's own 20:00. BullMQ on
  Redis schedules them; the job logic is plain functions, tested against Postgres with
  no queue in the way. The API still runs without Redis — the worker does not.
- Expo app with five tabs: timer, feed, battle, friends, profile.
- Seed builds a populated world — 5 users, 166 sessions, 19 posts, friendships both
  accepted and pending, two duels, badges and an active season. User ids are fixed,
  so the dev client and the tests address the same rows.

**Not done yet**

- Clerk is wired but untested against a real tenant — no Clerk account exists yet.
- Push delivery is written and tested but not yet driven by a queue: `deliver()` is
  exported and nothing calls it on a schedule.
- Notification preferences. The 3-per-day cap is currently the only throttle a user
  gets, and they cannot choose what it applies to.
- Two cascades still take a third party's data with a purged account: reports the
  purged user filed, and duels they took part in. Both need a schema change; argued
  at the top of `jobs/tasks/account-erasure.ts`.
- No leagues. Five tiers of thirty needs 150 weekly actives; friend rankings stand in.
- No guilds, no messaging, no realtime.
- The mobile app has never been opened on a device.

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
