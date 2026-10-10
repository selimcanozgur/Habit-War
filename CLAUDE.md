# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Habit War is a reading-only habit app, and will stay reading-only. Each book is an enemy whose HP is its page count. The reader logs pages after reading, XP rewards consistency over volume, and the character levels up. There is no timer. [docs/product-v2.md](docs/product-v2.md) is the authoritative product spec. If the code and that doc disagree, the doc wins and the code gets fixed. `docs/product-spec.md` and `docs/game-design.md` describe the old multi-habit product and are historical only.

npm-workspaces monorepo, Node >= 22, TypeScript everywhere:

- `packages/domain` (`@habitwar/domain`): pure reading rules, no dependencies
- `apps/api` (`@habitwar/api`): Fastify 5 + Prisma 6 (Postgres) + BullMQ worker (Redis)
- `apps/mobile` (`@habitwar/mobile`): Expo + expo-router, React Query, zustand
- `infra/docker-compose.yml`: Postgres 16 + Redis 7 for local work

The app ships in Turkish and English. Code and comments are in English.

## Commands

From the repo root:

```bash
npm install
npm run db:up                 # Postgres + Redis via Docker (db:down, db:logs)
npm test                      # every workspace
npm run typecheck             # every workspace
```

API (`cd apps/api`; needs `apps/api/.env`, copied from `.env.example`):

```bash
npx prisma migrate dev        # apply migrations / create a new one
npm run db:seed               # fixed-id seed users: selimcan (3 weeks of history), yeni (not onboarded)
npm run dev                   # tsx watch on :3000
npm run worker                # background jobs process (requires Redis)
npm test                      # vitest, against the real Postgres
npx vitest run src/modules/reading/__tests__/reading.test.ts   # single file
npx vitest run -t "name of test"                               # single test by name
```

Domain: `cd packages/domain && npm test`. Mobile: `cd apps/mobile && npm start` (also `web`).

### Gotchas

- `@habitwar/domain` is consumed through its `dist/` (package `exports` point there). After changing domain code, run `npm run build -w @habitwar/domain` or the API and mobile app keep seeing the old build.
- API tests hit a real Postgres (no mocks), run serially (`fileParallelism: false`), and namespace their rows by a `test_*` username prefix. `src/__tests__/setup.ts` loads `apps/api/.env`.
- The mobile app signs in with real tokens, so with the default `AUTH_MODE=dev` in `.env` every `/v1` call from the app fails. To run the app locally, start the API with `AUTH_MODE=token AUTH_JWT_SECRET=<32+ chars>`. Seed accounts use the password `habitwar123`. `x-dev-user-id` works only for curl and tests.
- `npm run typecheck` in the API uses `tsconfig.typecheck.json`, which also covers `prisma/seed.ts`.
- Migrations are append-only history. `20261010120000_reading_pivot` drops every pre-pivot table. Add new migrations on top of it and never rewrite old ones.

## Architecture

### Domain package owns every number

`packages/domain/src`:
- `reading.ts`: log scoring, book HP, clamping pages to the book, days-read window, smaller-goal suggestion
- `leveling.ts`: level curve
- `streaks.ts`: local date keys and the streak with grace days
- `balance.ts`: all tunables, so a retune is a one-file change

Everything is pure: callers pass `now` and timezones in. The core rule is that a daily goal bonus (`DAILY_GOAL_BONUS_XP`) dwarfs per-page XP, so reading a little every day beats a binge. The streak forgives `STREAK_GRACE_DAYS` (1) missed day.

### API

- `src/server.ts` (`buildServer`) is the app factory, so tests use `app.inject()`. Plugin order: error handler → security headers → CORS → rate limit → Prisma → auth.
- Modules live in `src/modules/<name>/`, each with `routes.ts` (`/v1` prefix, its own `requireUser` preHandler), `schemas.ts` (Zod) and `service.ts` (a class taking `{ prisma, now }`):
  - `auth`: own JWT auth with refresh-token rows, argon2, Google/Apple.
  - `me`: profile, settings, onboarding, push tokens, KVKK export and deletion.
  - `books`: shelf CRUD. Never moves pages.
  - `reading`: `POST /books/:id/logs` and `GET /today`.
- **Reading log write path** (`modules/reading/service.ts`): one transaction locks the user row (`SELECT … FOR UPDATE`) so concurrent logs can't both pay the goal bonus. It clamps pages to the book, scores via the domain, then writes `ReadingLog` + `XpLedger` + book + user. It's idempotent on `clientRequestId`: a retry returns the original result with `replayed: true` and status 200.
- **Invariants:**
  - `User.xp` is a cache of the append-only `XpLedger`.
  - Days are local date keys in the user's timezone.
  - Deleting a book keeps the XP it earned (the ledger link is `SetNull`).
- **Errors:** throw `AppError` from `src/lib/errors.ts`. The response envelope is `{ error: { code, message, details? } }`. The client localizes by `code` (and `details`), never by `message`.
- **Jobs** (`src/jobs/`, separate worker process): `account-erasure` (nightly hard delete after the 30-day retention window) and `reading-reminder` (every 15 minutes). The reminder picks users whose chosen local `reminderTime` has passed, who haven't read today, and claims them with `lastRemindedDate` so nobody gets two reminders in a day. Tasks are plain functions taking a `JobContext` and are tested without Redis. The Expo client is injectable (`lib/push.ts`).

### API ↔ mobile contract

The two sides share domain types (`BookProgress`, `LevelProgress`, `ReadingLogScore`) but not response envelopes. `apps/api/src/__tests__/reading-api.test.ts` asserts the exact keys `apps/mobile/src/api/*` reads. Change both together.

### Mobile

- Routes are in `app/`: the `(auth)` group, `onboarding.tsx`, and the `(tabs)` group (`index` Bugün, `shelf` Raf, `profile`). `(tabs)/_layout.tsx` redirects to sign-in or onboarding, syncs the app language from `profile.locale`, and registers for push when a reminder is set.
- **i18n:** every string lives in `src/i18n/strings.ts`. `en` is typed as `Strings` (the shape of `tr`), so a missing translation fails typechecking. Read strings with `useT()` and never hard-code UI text.
- `src/theme.ts` holds all visual tokens (palette from `DESIGN.md`).
- `src/confirm.ts` wraps destructive confirmations, because `Alert.alert` is a no-op on react-native-web.
- The character art is not built yet. The product doc says the look changes in level stages, driven by one config file so new art needs no code changes.
