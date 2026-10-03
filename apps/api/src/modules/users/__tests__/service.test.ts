import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUser,
  deriveDisplayName,
  deriveUsername,
  findUserByEmail,
  softDeleteUser,
  type NewIdentity,
} from '../service.js';

const prisma = new PrismaClient();

/** Test rows are namespaced so a failed run cannot poison the seeded developer data. */
const TEST_PREFIX = 'test_users_';

function identity(overrides: Partial<NewIdentity> = {}): NewIdentity {
  return {
    email: `${TEST_PREFIX}ayse@example.com`,
    username: null,
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    imageUrl: 'https://img.example.com/a.png',
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('deriveUsername', () => {
  it('prefers the supplied username', () => {
    expect(deriveUsername(identity({ username: 'AyseY' }))).toBe('aysey');
  });

  it('falls back to the email local part', () => {
    expect(deriveUsername(identity({ username: null, email: 'burak.demir@example.com' }))).toBe(
      'burak_demir',
    );
  });

  /**
   * An address like `x@example.com` has a local part below the length floor, and a
   * provider may send no username at all. Something legal still has to come out, or
   * the signup fails for a perfectly valid address.
   */
  it('invents a name when nothing supplied is usable', () => {
    const result = deriveUsername(identity({ username: null, email: 'x@example.com' }));
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toMatch(/^[a-z0-9_]+$/);
  });

  it('strips characters the product does not allow', () => {
    expect(deriveUsername(identity({ username: 'Ayşe Yılmaz!' }))).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('deriveDisplayName', () => {
  it('joins the name parts that arrived', () => {
    expect(deriveDisplayName(identity(), 'fallback')).toBe('Ayşe Yılmaz');
  });

  /**
   * Apple sends no name at all after the first authorisation, so this is the normal
   * path for an Apple account rather than an edge case.
   */
  it('falls back to the username when no name arrived', () => {
    expect(
      deriveDisplayName(identity({ firstName: null, lastName: null }), `${TEST_PREFIX}x`),
    ).toBe(`${TEST_PREFIX}x`);
  });
});

describe('createUser', () => {
  it('creates an account from an identity', async () => {
    const user = await createUser(prisma, identity({ username: `${TEST_PREFIX}a` }), {
      passwordHash: 'digest',
      emailVerified: false,
    });

    expect(user.username).toBe(`${TEST_PREFIX}a`);
    expect(user.displayName).toBe('Ayşe Yılmaz');
    expect(user.passwordHash).toBe('digest');
    expect(user.emailVerifiedAt).toBeNull();
  });

  /** A provider has already verified the address; a second mail would be noise. */
  it('marks a provider account verified on creation', async () => {
    const user = await createUser(prisma, identity({ username: `${TEST_PREFIX}b` }), {
      passwordHash: null,
      emailVerified: true,
    });

    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('suffixes a username that is already taken', async () => {
    const first = await createUser(prisma, identity({ username: `${TEST_PREFIX}dup` }), {
      emailVerified: true,
    });
    const second = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}dup`, email: `${TEST_PREFIX}other@example.com` }),
      { emailVerified: true },
    );

    expect(second.username).not.toBe(first.username);
    expect(second.username.startsWith(`${TEST_PREFIX}dup`.slice(0, 10))).toBe(true);
  });

  /**
   * Addresses are stored lowercased. Without that, `Ali@x.com` and `ali@x.com` would
   * be two accounts, and the user would be unable to sign in to whichever one they
   * did not create.
   */
  it('lowercases the email', async () => {
    const user = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}case`, email: `${TEST_PREFIX}MiXeD@Example.COM` }),
      { emailVerified: true },
    );

    expect(user.email).toBe(`${TEST_PREFIX}mixed@example.com`);
  });
});

describe('findUserByEmail', () => {
  it('matches regardless of case', async () => {
    await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}find`, email: `${TEST_PREFIX}find@example.com` }),
      { emailVerified: true },
    );

    const found = await findUserByEmail(prisma, `${TEST_PREFIX}FIND@EXAMPLE.COM`);
    expect(found?.username).toBe(`${TEST_PREFIX}find`);
  });

  /** A deleted account must not be findable, or sign-in would resurrect it. */
  it('ignores deleted accounts', async () => {
    const user = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}gone`, email: `${TEST_PREFIX}gone@example.com` }),
      { emailVerified: true },
    );
    await softDeleteUser(prisma, user.id);

    expect(await findUserByEmail(prisma, `${TEST_PREFIX}gone@example.com`)).toBeNull();
  });
});

describe('softDeleteUser', () => {
  it('marks the row rather than dropping it', async () => {
    const user = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}soft`, email: `${TEST_PREFIX}soft@example.com` }),
      { emailVerified: true },
    );

    const deleted = await softDeleteUser(prisma, user.id);
    expect(deleted?.deletedAt).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  /**
   * An account marked deleted whose tokens still work is not deleted in any sense
   * the user would recognise.
   */
  it('revokes every live session', async () => {
    const user = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}rev`, email: `${TEST_PREFIX}rev@example.com` }),
      { emailVerified: true },
    );
    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: `${TEST_PREFIX}hash`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await softDeleteUser(prisma, user.id);

    const sessions = await prisma.authSession.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revokedAt).not.toBeNull();
  });

  /** Idempotent: a repeat must not reset the retention clock. */
  it('keeps the original timestamp on a repeat', async () => {
    const user = await createUser(
      prisma,
      identity({ username: `${TEST_PREFIX}twice`, email: `${TEST_PREFIX}twice@example.com` }),
      { emailVerified: true },
    );

    const first = await softDeleteUser(prisma, user.id);
    const second = await softDeleteUser(prisma, user.id);

    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
  });

  it('returns null for an unknown id', async () => {
    expect(await softDeleteUser(prisma, 'does-not-exist')).toBeNull();
  });
});
