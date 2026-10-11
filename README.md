# Habit War

A reading habit app. Every book is an enemy whose health is its page count. You log
the pages you read, the book loses health, and your character grows. Reading a little
every day beats reading a lot once.

The product definition is [docs/product-v2.md](docs/product-v2.md).

---

## Layout

```
habit-war/
├─ docs/                   Product definition, ADRs, the original spec (historical)
├─ infra/                  Postgres 16 + Redis 7 for local development
├─ packages/domain/        @habitwar/domain — pure reading rules, zero dependencies
├─ apps/api/               @habitwar/api — Fastify + Prisma, plus a BullMQ worker
└─ apps/mobile/            @habitwar/mobile — Expo + expo-router, Turkish and English
```

`packages/domain` holds every rule that produces a number: page XP, the daily goal
bonus, book health, the level curve, the forgiving streak and the smaller-goal
suggestion. The rules are pure functions, and the API and the app both use them.

---

## Getting started

```bash
npm install
npm run db:up                    # needs Docker Desktop running

cd apps/api
cp .env.example .env
npx prisma migrate dev
npm run db:seed                  # selimcan@example.com / yeni@example.com, password habitwar123

# The app signs in with real tokens, so run the API in token mode:
AUTH_MODE=token AUTH_JWT_SECRET=<at least 32 characters> npm run dev

cd ../mobile
npm start                        # or: npm run web
```

| Command | What it does |
|---|---|
| `npm test` | Runs every workspace's tests |
| `npm run typecheck` | Type-checks every workspace |
| `npm run db:up` / `db:down` | Starts / stops Postgres + Redis |
| `cd apps/api && npm run worker` | Background jobs: reading reminders, account erasure |

---

## Current state

**Working end to end**

- Shelf: add, edit and delete books. Finished books stay as trophies.
- Page logging: retry-safe, clamped to the book's last page, scored by the domain rules.
- Today screen: the daily goal, the streak, days read in the last 30 days, and a
  smaller-goal suggestion when the goal was missed on most days of the past week.
- Profile: level and XP, stats, daily goal, reminder time, language, sign-out and
  account deletion (KVKK: export and erasure).
- Reading reminder at the time each reader chose, in their language, once a day.
- Own authentication: email and password, Google and Apple, refresh-token rotation.
- Tests: 63 domain tests and 97 API tests, against a real Postgres.

**Not done yet**

- Character art. The look should change in stages as the reader levels up
  (docs/product-v2.md).
- Push reminders are not verified on a real device. They need an EAS project id.
- Undoing a mistyped page log.

---

## Known issues

`npm audit` reports advisories in `deepmerge-ts`, reached only through the Prisma
**CLI**. It is a development dependency, not part of the running server.
