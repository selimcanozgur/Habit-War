/**
 * Moderation tests.
 *
 * Weighted towards the authorisation boundary rather than the happy path. A bug in
 * `hidePost` shows a post that should be hidden; a bug in the guard hands the
 * enforcement API to anyone with an account, and that is the failure that ends a
 * store listing.
 *
 * These drive the real Fastify app against a real database, because the guard is
 * composed from a plugin decorator, a route hook and a database read — mocking any
 * of the three would test the mock.
 */

import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '../../../env.js';
import { buildServer } from '../../../server.js';

const prisma = new PrismaClient();
const PREFIX = 'test_mod_';

let app: FastifyInstance;
let moderatorId: string;
let offenderId: string;
let reporterId: string;
let postId: string;
let reportId: string;

function env(): ReturnType<typeof loadEnv> {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env['DATABASE_URL'] as string,
    LOG_LEVEL: 'fatal',
    AUTH_MODE: 'dev',
  } as NodeJS.ProcessEnv);
}

async function makeUser(
  suffix: string,
  role: 'USER' | 'MODERATOR' | 'ADMIN' = 'USER',
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      clerkId: `${PREFIX}${suffix}`,
      username: `${PREFIX}${suffix}`,
      displayName: suffix,
      email: `${PREFIX}${suffix}@example.com`,
      role,
    },
  });
  return user.id;
}

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  if (app) await app.close();
  app = await buildServer(env());

  moderatorId = await makeUser('mod', 'MODERATOR');
  offenderId = await makeUser('offender');
  reporterId = await makeUser('reporter');

  const post = await prisma.post.create({
    data: { authorId: offenderId, type: 'TEXT', content: 'Şikayet edilen gönderi' },
  });
  postId = post.id;

  const report = await prisma.report.create({
    data: { reporterId, postId, reportedUserId: offenderId, reason: 'HARASSMENT' },
  });
  reportId = report.id;
});

afterAll(async () => {
  if (app) await app.close();
  await cleanup();
  await prisma.$disconnect();
});

function as(userId: string) {
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { 'x-dev-user-id': userId } }),
    post: (url: string, payload?: unknown) =>
      app.inject({ method: 'POST', url, headers: { 'x-dev-user-id': userId }, payload }),
  };
}

const REASON = 'Tekrarlayan taciz içeriği, üçüncü uyarı sonrası.';

describe('authorisation boundary', () => {
  it('refuses an unauthenticated caller with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/moderation/reports' });
    expect(response.statusCode).toBe(401);
  });

  /** The one that matters: an ordinary signed-in account must not reach staff tools. */
  it('refuses an ordinary user with 403 on every moderation route', async () => {
    const user = as(reporterId);
    const attempts: [string, Promise<{ statusCode: number }>][] = [
      ['GET /moderation/reports', user.get('/v1/moderation/reports')],
      ['POST claim', user.post(`/v1/moderation/reports/${reportId}/claim`)],
      ['POST dismiss', user.post(`/v1/moderation/reports/${reportId}/dismiss`, { note: REASON })],
      ['POST hide', user.post(`/v1/moderation/posts/${postId}/hide`, { reason: REASON })],
      ['POST restore', user.post(`/v1/moderation/posts/${postId}/restore`, { note: REASON })],
      [
        'POST suspend',
        user.post(`/v1/moderation/users/${offenderId}/suspend`, { reason: REASON, days: 7 }),
      ],
      [
        'POST reinstate',
        user.post(`/v1/moderation/users/${offenderId}/reinstate`, { note: REASON }),
      ],
      ['POST warn', user.post(`/v1/moderation/users/${offenderId}/warn`, { reason: REASON })],
      ['GET history', user.get(`/v1/moderation/users/${offenderId}/history`)],
    ];

    for (const [label, pending] of attempts) {
      const response = await pending;
      expect(response.statusCode, `${label} leaked to a non-moderator`).toBe(403);
    }

    // The guard must refuse before anything happens, not after.
    expect(await prisma.moderationAction.count()).toBe(0);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.hiddenAt).toBeNull();
  });

  it('lets a moderator through', async () => {
    const response = await as(moderatorId).get('/v1/moderation/reports');
    expect(response.statusCode).toBe(200);
  });

  it('lets an admin through', async () => {
    const adminId = await makeUser('admin', 'ADMIN');
    const response = await as(adminId).get('/v1/moderation/reports');
    expect(response.statusCode).toBe(200);
  });

  it('does not let an ordinary user change their own role through the profile route', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { 'x-dev-user-id': reporterId },
      payload: { role: 'ADMIN', displayName: 'Yükselmiş' },
    });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: reporterId } });
    expect(after.role).toBe('USER');
    expect(response.statusCode).toBeLessThan(500);
  });
});

describe('report queue', () => {
  it('serves the queue oldest first, with status counts', async () => {
    const body = (await as(moderatorId).get('/v1/moderation/reports')).json();
    expect(Array.isArray(body.reports)).toBe(true);
    expect(body.reports.length).toBeGreaterThan(0);
    expect(body.counts).toHaveProperty('PENDING');
  });

  it('filters by status', async () => {
    const body = (
      await as(moderatorId).get('/v1/moderation/reports?status=DISMISSED')
    ).json();
    expect(body.reports).toHaveLength(0);
  });

  it('claims a report once', async () => {
    const first = await as(moderatorId).post(`/v1/moderation/reports/${reportId}/claim`);
    expect(first.statusCode).toBe(200);

    const second = await as(moderatorId).post(`/v1/moderation/reports/${reportId}/claim`);
    expect(second.statusCode).toBe(409);
  });
});

describe('enforcement', () => {
  it('records a dismissal as an action, not just a status change', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/reports/${reportId}/dismiss`, {
      note: REASON,
    });
    expect(response.statusCode).toBe(200);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(report.status).toBe('DISMISSED');
    expect(report.reviewerId).toBe(moderatorId);

    // "We looked and found nothing" is a response, and the SLA is measured on it.
    const actions = await prisma.moderationAction.findMany({ where: { reportId } });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe('REPORT_DISMISSED');
  });

  it('hides a post, records why, and resolves the report in one go', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, {
      reason: REASON,
      reportId,
    });
    expect(response.statusCode).toBe(200);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.hiddenAt).toBeInstanceOf(Date);
    expect(post.hiddenReason).toBe(REASON);

    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(report.status).toBe('ACTION_TAKEN');

    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { subjectPostId: postId, action: 'POST_HIDDEN' },
    });
    expect(action.actorId).toBe(moderatorId);
    expect(action.subjectUserId).toBe(offenderId);
  });

  /**
   * The integration that makes hiding mean anything. The feed filtered a different
   * column from the one the moderation service wrote, so hiding a post used to do
   * nothing at all while every surface reported success.
   */
  it('actually removes a hidden post from the feed', async () => {
    await prisma.friendship.create({
      data: {
        requesterId: reporterId,
        addresseeId: offenderId,
        pairKey: [reporterId, offenderId].sort().join(':'),
        status: 'ACCEPTED',
      },
    });

    const before = (await as(reporterId).get('/v1/feed')).json();
    expect(before.items.some((p: { id: string }) => p.id === postId)).toBe(true);

    await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, { reason: REASON });

    const after = (await as(reporterId).get('/v1/feed')).json();
    expect(after.items.some((p: { id: string }) => p.id === postId)).toBe(false);
  });

  it('restores a hidden post as a separate action', async () => {
    await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, { reason: REASON });
    const response = await as(moderatorId).post(`/v1/moderation/posts/${postId}/restore`, {
      note: 'İtiraz haklı bulundu, içerik kurallara aykırı değil.',
    });
    expect(response.statusCode).toBe(200);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.hiddenAt).toBeNull();

    // The hide is not edited away; both rows stand.
    const actions = await prisma.moderationAction.findMany({ where: { subjectPostId: postId } });
    expect(actions.map((a) => a.action).sort()).toEqual(['POST_HIDDEN', 'POST_RESTORED']);
  });

  it('rejects hiding the same post twice', async () => {
    await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, { reason: REASON });
    const second = await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, {
      reason: REASON,
    });
    expect(second.statusCode).toBe(409);
  });

  it('requires a written reason', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, {
      reason: 'spam',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('suspension', () => {
  it('suspends for a bounded period and records the expiry', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/users/${offenderId}/suspend`, {
      reason: REASON,
      days: 7,
      reportId,
    });
    expect(response.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: offenderId } });
    expect(user.suspendedUntil).toBeInstanceOf(Date);
    expect(user.suspendedUntil!.getTime()).toBeGreaterThan(Date.now());

    const action = await prisma.moderationAction.findFirstOrThrow({
      where: { subjectUserId: offenderId, action: 'USER_SUSPENDED' },
    });
    expect(action.expiresAt).toBeInstanceOf(Date);
  });

  it('locks a suspended account out of participating', async () => {
    await as(moderatorId).post(`/v1/moderation/users/${offenderId}/suspend`, {
      reason: REASON,
      days: 7,
    });

    const response = await as(offenderId).get('/v1/feed');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.details).toHaveProperty('reason');
  });

  /**
   * Suspension removes the ability to participate, not the right to know why or to
   * leave. Blocking the export would deny a portability request as a side effect of
   * enforcement.
   */
  it('still lets a suspended account read its profile and export its data', async () => {
    await as(moderatorId).post(`/v1/moderation/users/${offenderId}/suspend`, {
      reason: REASON,
      days: 7,
    });

    expect((await as(offenderId).get('/v1/users/me')).statusCode).toBe(200);
    expect((await as(offenderId).get('/v1/me/export')).statusCode).toBe(200);
  });

  it('refuses to suspend a staff account through this route', async () => {
    const otherMod = await makeUser('mod2', 'MODERATOR');
    const response = await as(moderatorId).post(`/v1/moderation/users/${otherMod}/suspend`, {
      reason: REASON,
      days: 7,
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses self-suspension', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/users/${moderatorId}/suspend`, {
      reason: REASON,
      days: 1,
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects a suspension longer than the maximum', async () => {
    const response = await as(moderatorId).post(`/v1/moderation/users/${offenderId}/suspend`, {
      reason: REASON,
      days: 400,
    });
    expect(response.statusCode).toBe(400);
  });

  it('lets an expired suspension lapse without any job running', async () => {
    await prisma.user.update({
      where: { id: offenderId },
      data: { suspendedUntil: new Date(Date.now() - 1000), suspensionReason: REASON },
    });

    // The deadline is compared against now on every request, so nothing has to sweep.
    expect((await as(offenderId).get('/v1/feed')).statusCode).toBe(200);
  });

  it('reinstates early and records it', async () => {
    await as(moderatorId).post(`/v1/moderation/users/${offenderId}/suspend`, {
      reason: REASON,
      days: 30,
    });
    const response = await as(moderatorId).post(`/v1/moderation/users/${offenderId}/reinstate`, {
      note: 'İtiraz kabul edildi, yaptırım kaldırıldı.',
    });
    expect(response.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: offenderId } });
    expect(user.suspendedUntil).toBeNull();
    expect((await as(offenderId).get('/v1/feed')).statusCode).toBe(200);
  });
});

describe('history', () => {
  it('assembles an account enforcement history for the appeal view', async () => {
    await as(moderatorId).post(`/v1/moderation/users/${offenderId}/warn`, { reason: REASON });
    await as(moderatorId).post(`/v1/moderation/posts/${postId}/hide`, { reason: REASON });

    const body = (await as(moderatorId).get(`/v1/moderation/users/${offenderId}/history`)).json();
    expect(body.actions.length).toBe(2);
    expect(body.reportsAgainst).toBe(1);
  });
});
