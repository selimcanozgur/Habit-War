import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveDisplayName,
  deriveUsername,
  resolveUser,
  softDeleteUser,
  syncUser,
  type ClerkIdentity,
} from '../service.js';

const prisma = new PrismaClient();

/** Test rows are namespaced so a failed run cannot poison the seeded developer data. */
const TEST_PREFIX = 'test_users_';

function identity(overrides: Partial<ClerkIdentity> = {}): ClerkIdentity {
  return {
    clerkId: `${TEST_PREFIX}clerk_1`,
    email: 'ayse.yilmaz@example.com',
    username: null,
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    imageUrl: 'https://img.example.com/a.png',
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('deriveUsername', () => {
  it('prefers the Clerk username', () => {
    expect(deriveUsername(identity({ username: 'selimcan' }))).toBe('selimcan');
  });

  it('falls back to the email local part', () => {
    expect(deriveUsername(identity({ username: null }))).toBe('ayse_yilmaz');
  });

  it('falls back to the Clerk id when nothing else is usable', () => {
    const result = deriveUsername(identity({ username: null, email: 'a@b.com', clerkId: 'user_2abcDEFG' }));
    expect(result).toBe('user_2abcDEFG'.replace(/^user_/, '').slice(0, 8).length > 0 ? 'user_2abcdefg' : result);
  });

  it('normalises characters the product does not allow', () => {
    expect(deriveUsername(identity({ username: 'Ali..Veli!!' }))).toBe('ali_veli');
  });

  it('never exceeds the length limit', () => {
    const long = deriveUsername(identity({ username: 'a'.repeat(200) }));
    expect(long.length).toBeLessThanOrEqual(20);
  });

  it('rejects a username that normalises to something too short', () => {
    // "!!" collapses to nothing, so the email local part wins.
    expect(deriveUsername(identity({ username: '!!' }))).toBe('ayse_yilmaz');
  });
});

describe('deriveDisplayName', () => {
  it('joins the name parts Clerk has', () => {
    expect(deriveDisplayName(identity(), 'fallback')).toBe('Ayşe Yılmaz');
  });

  it('uses whichever part exists', () => {
    expect(deriveDisplayName(identity({ lastName: null }), 'fallback')).toBe('Ayşe');
  });

  it('falls back to the username when Clerk has no name', () => {
    expect(deriveDisplayName(identity({ firstName: null, lastName: null }), 'selimcan')).toBe(
      'selimcan',
    );
  });
});

describe('resolveUser', () => {
  it('provisions a user on their first authenticated request', async () => {
    const user = await resolveUser(prisma, identity().clerkId, async () => identity());

    expect(user.clerkId).toBe(identity().clerkId);
    expect(user.username).toBe('ayse_yilmaz');
    expect(user.displayName).toBe('Ayşe Yılmaz');
    expect(user.email).toBe('ayse.yilmaz@example.com');
    expect(user.level).toBe(1);
    expect(user.cycleXp).toBe(0);
  });

  it('returns the existing user without calling Clerk again', async () => {
    const first = await resolveUser(prisma, identity().clerkId, async () => identity());

    let calls = 0;
    const second = await resolveUser(prisma, identity().clerkId, async () => {
      calls++;
      return identity();
    });

    expect(second.id).toBe(first.id);
    expect(calls).toBe(0);
  });

  it('gives a colliding username a numeric suffix', async () => {
    const first = await resolveUser(prisma, `${TEST_PREFIX}clerk_a`, async () =>
      identity({ clerkId: `${TEST_PREFIX}clerk_a`, username: `${TEST_PREFIX}dup` }),
    );
    const second = await resolveUser(prisma, `${TEST_PREFIX}clerk_b`, async () =>
      identity({
        clerkId: `${TEST_PREFIX}clerk_b`,
        username: `${TEST_PREFIX}dup`,
        email: 'other@example.com',
      }),
    );

    expect(first.username).toBe(`${TEST_PREFIX}dup`);
    expect(second.username).not.toBe(first.username);
    expect(second.username).toMatch(/2$/);
  });

  it('propagates a Clerk lookup failure instead of creating a half-built account', async () => {
    await expect(
      resolveUser(prisma, `${TEST_PREFIX}clerk_fail`, async () => {
        throw new Error('clerk unreachable');
      }),
    ).rejects.toThrow('clerk unreachable');

    const created = await prisma.user.findUnique({ where: { clerkId: `${TEST_PREFIX}clerk_fail` } });
    expect(created).toBeNull();
  });

  /**
   * Two requests from a brand new user can arrive together, both miss the lookup and
   * both insert. The loser of that race must read the winner's row, not error.
   */
  it('survives two concurrent first requests', async () => {
    const clerkId = `${TEST_PREFIX}clerk_race`;
    const fetcher = async (): Promise<ClerkIdentity> =>
      identity({ clerkId, email: 'race@example.com', username: `${TEST_PREFIX}race` });

    const [a, b] = await Promise.all([
      resolveUser(prisma, clerkId, fetcher),
      resolveUser(prisma, clerkId, fetcher),
    ]);

    expect(a.id).toBe(b.id);
    const rows = await prisma.user.findMany({ where: { clerkId } });
    expect(rows).toHaveLength(1);
  });
});

describe('syncUser', () => {
  it('updates the fields Clerk owns', async () => {
    await resolveUser(prisma, identity().clerkId, async () => identity());

    const updated = await syncUser(
      prisma,
      identity({ email: 'yeni@example.com', imageUrl: 'https://img.example.com/b.png' }),
    );

    expect(updated?.email).toBe('yeni@example.com');
    expect(updated?.avatarUrl).toBe('https://img.example.com/b.png');
  });

  it('leaves the user-editable profile alone', async () => {
    const created = await resolveUser(prisma, identity().clerkId, async () => identity());
    await prisma.user.update({
      where: { id: created.id },
      data: { displayName: 'Kendi Seçtiğim Ad', username: `${TEST_PREFIX}kendi` },
    });

    const updated = await syncUser(prisma, identity({ username: 'clerk_tarafindan' }));

    expect(updated?.displayName).toBe('Kendi Seçtiğim Ad');
    expect(updated?.username).toBe(`${TEST_PREFIX}kendi`);
  });

  it('is a no-op for a user who has never signed in here', async () => {
    expect(await syncUser(prisma, identity({ clerkId: `${TEST_PREFIX}unknown` }))).toBeNull();
  });
});

describe('softDeleteUser', () => {
  it('marks the account deleted but keeps the row', async () => {
    const created = await resolveUser(prisma, identity().clerkId, async () => identity());

    const deleted = await softDeleteUser(prisma, identity().clerkId);
    expect(deleted?.deletedAt).toBeInstanceOf(Date);

    // The row survives, because sessions and any XP dispute hang off it.
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    expect(row).not.toBeNull();
  });

  it('does not move the deletion timestamp on a repeated event', async () => {
    await resolveUser(prisma, identity().clerkId, async () => identity());
    const first = await softDeleteUser(prisma, identity().clerkId);
    const second = await softDeleteUser(prisma, identity().clerkId);

    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
  });

  it('is a no-op for an unknown id', async () => {
    expect(await softDeleteUser(prisma, `${TEST_PREFIX}never_existed`)).toBeNull();
  });
});
