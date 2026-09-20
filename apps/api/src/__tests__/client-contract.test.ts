/**
 * Client contract tests.
 *
 * These exist because of a bug that cost real time: the API paginated the feed as
 * `{ items }` while the mobile client read `{ posts }`. Nothing threw. The client's
 * defensive normaliser turned the missing key into an empty array, so every screen
 * rendered "no posts yet" against a database full of them — a silent integration
 * failure that typechecking cannot catch, because the two sides are separate
 * programs that never share a type.
 *
 * So each test below asserts the exact envelope key the mobile client reads. If an
 * endpoint is reshaped, this fails here rather than as an empty screen.
 *
 * Fixtures come from `prisma/seed.ts`, which fixes user ids precisely so tests and
 * the dev client can address the same rows.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../env.js';
import { buildServer } from '../server.js';

const prisma = new PrismaClient();

/** Seeded primary account: friends, a pending request each way, duels, badges. */
const SEED_USER_ID = 'cseedselimcan000000000000';

let app: FastifyInstance;
let seeded = false;

beforeAll(async () => {
  const user = await prisma.user.findUnique({ where: { id: SEED_USER_ID } });
  seeded = user !== null;

  app = await buildServer(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env['DATABASE_URL'] as string,
      LOG_LEVEL: 'fatal',
      AUTH_MODE: 'dev',
    } as NodeJS.ProcessEnv),
  );
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function get(url: string): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: { 'x-dev-user-id': SEED_USER_ID },
  });
  expect(response.statusCode, `${url} answered ${response.statusCode}`).toBe(200);
  return response.json() as Record<string, unknown>;
}

/**
 * Skips the suite rather than failing it when the database has not been seeded.
 * A contract test that fails for want of fixtures teaches the reader to ignore it.
 */
function requireSeed(): void {
  if (!seeded) {
    throw new Error(
      `Seed data missing (user ${SEED_USER_ID}). Run \`npm run db:seed\` in apps/api.`,
    );
  }
}

describe('feed contract', () => {
  it('paginates as { items, nextCursor }', async () => {
    requireSeed();
    const body = await get('/v1/feed');

    expect(Array.isArray(body['items'])).toBe(true);
    expect(body).toHaveProperty('nextCursor');
    expect((body['items'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('gives every post the fields the card renders', async () => {
    requireSeed();
    const [post] = (await get('/v1/feed'))['items'] as Record<string, unknown>[];
    expect(post).toBeDefined();

    for (const field of ['id', 'type', 'likeCount', 'createdAt', 'author']) {
      expect(post, `post is missing ${field}`).toHaveProperty(field);
    }
    const author = post?.['author'] as Record<string, unknown>;
    for (const field of ['id', 'username', 'displayName', 'level']) {
      expect(author, `author is missing ${field}`).toHaveProperty(field);
    }
  });

  it('serves the discover scope too', async () => {
    requireSeed();
    const body = await get('/v1/feed?scope=discover');
    expect(Array.isArray(body['items'])).toBe(true);
  });
});

describe('social contract', () => {
  it('returns friends under { friends }', async () => {
    requireSeed();
    const body = await get('/v1/friends');
    expect(Array.isArray(body['friends'])).toBe(true);
    expect((body['friends'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('splits requests into { incoming, outgoing }', async () => {
    requireSeed();
    const body = await get('/v1/friends/requests');
    expect(Array.isArray(body['incoming'])).toBe(true);
    expect(Array.isArray(body['outgoing'])).toBe(true);
  });

  it('splits duels into { active, past }', async () => {
    requireSeed();
    const body = await get('/v1/challenges');
    expect(Array.isArray(body['active'])).toBe(true);
    expect(Array.isArray(body['past'])).toBe(true);
  });

  it('nests the leaderboard under { leaderboard: { entries } }', async () => {
    requireSeed();
    const board = (await get('/v1/leaderboard/friends'))['leaderboard'] as Record<string, unknown>;
    expect(board).toBeDefined();
    expect(Array.isArray(board['entries'])).toBe(true);
  });
});

describe('progression contract', () => {
  it('returns the profile fields the character card reads', async () => {
    requireSeed();
    const user = (await get('/v1/users/me'))['user'] as Record<string, unknown>;
    expect(user).toBeDefined();

    for (const field of ['id', 'username', 'displayName', 'progression', 'stats']) {
      expect(user, `user is missing ${field}`).toHaveProperty(field);
    }

    const progression = user['progression'] as Record<string, unknown>;
    for (const field of ['level', 'xpIntoLevel', 'xpForNextLevel', 'ratio']) {
      expect(progression, `progression is missing ${field}`).toHaveProperty(field);
    }

    // Stats are the derived point values, not the raw XP accumulators — the two are
    // returned under names that say which is which precisely so a client cannot
    // render one believing it is the other.
    const stats = user['stats'] as Record<string, number>;
    for (const stat of ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX']) {
      expect(typeof stats[stat], `stats.${stat} is not a number`).toBe('number');
    }
  });

  it('returns achievements with an unlocked count', async () => {
    requireSeed();
    const body = await get('/v1/achievements');
    expect(Array.isArray(body['achievements'])).toBe(true);
    expect(typeof body['unlockedCount']).toBe('number');
  });

  it('returns the active season and its multiplier', async () => {
    requireSeed();
    const body = await get('/v1/seasons/current');
    expect(body).toHaveProperty('season');
    expect(typeof body['eventMultiplier']).toBe('number');
  });

  it('returns the notification inbox with an unread count', async () => {
    requireSeed();
    const body = await get('/v1/notifications');
    expect(Array.isArray(body['notifications'])).toBe(true);
    expect(typeof body['unreadCount']).toBe('number');
  });
});

describe('serialisation', () => {
  /**
   * `lifetimeXp` is a BigInt column and JSON has no BigInt. Serialising it without
   * conversion throws at runtime, on a route that otherwise looks fine in tests that
   * never reach it.
   */
  it('serialises lifetime XP without throwing on BigInt', async () => {
    requireSeed();
    const user = (await get('/v1/users/me'))['user'] as Record<string, unknown>;
    const progression = user['progression'] as Record<string, unknown>;
    expect(['string', 'number']).toContain(typeof progression['lifetimeXp']);
  });
});
