/**
 * Safety routes — blocking, reporting, consent and KVKK subject rights.
 *
 * Every route here is authenticated. There is no anonymous reporting path on purpose:
 * an unauthenticated report endpoint is a free moderation-queue flooding primitive,
 * and Guideline 1.2 is assessed on the response to reports, which an unrunnable queue
 * cannot deliver.
 *
 * Bodies are parsed with Zod rather than Fastify's JSON schema, matching the other
 * modules, so the parsed types flow into the service without a second set of
 * hand-written interfaces.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { SafetyService } from './service.js';
import {
  blockTargetBody,
  blockUsernameParams,
  createReportBody,
  deleteAccountBody,
  recordConsentBody,
} from './schemas.js';

export async function safetyRoutes(app: FastifyInstance): Promise<void> {
  const safety = new SafetyService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  // --- Blocks --------------------------------------------------------------

  app.post('/blocks', async (request, reply) => {
    const body = blockTargetBody.parse(request.body);
    const block = await safety.blockUser(request.userId, body.username, body.reason);
    return reply.status(201).send({ block: { id: block.id, createdAt: block.createdAt } });
  });

  app.delete('/blocks/:username', async (request) => {
    const { username } = blockUsernameParams.parse(request.params);
    return safety.unblockUser(request.userId, username);
  });

  app.get('/blocks', async (request) => {
    return { blocks: await safety.listBlocks(request.userId) };
  });

  // --- Reports -------------------------------------------------------------

  app.post('/reports', async (request, reply) => {
    const body = createReportBody.parse(request.body);
    const report = await safety.createReport({
      reporterId: request.userId,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      detail: body.detail,
    });

    // Only the receipt is returned. The reporter has no business seeing the
    // moderation trail (reviewer, resolution note) of a queue they do not staff, and
    // echoing the resolved target id back would confirm an account they may have
    // guessed at.
    return reply.status(201).send({
      report: { id: report.id, status: report.status, createdAt: report.createdAt },
    });
  });

  // --- Consent -------------------------------------------------------------

  app.get('/me/consents', async (request) => {
    return { consents: await safety.listConsents(request.userId) };
  });

  app.post('/me/consents', async (request, reply) => {
    const body = recordConsentBody.parse(request.body);

    // IP and user agent are captured server-side, never accepted from the client:
    // they are the evidence of the act of consent for the KVKK art. 4 burden of
    // proof, and evidence the subject can set is not evidence. They are stored for
    // this purpose only and purged with the account (see ConsentRecord).
    const record = await safety.recordConsent({
      userId: request.userId,
      type: body.type,
      version: body.version,
      granted: body.granted,
      source: body.source,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
    });

    return reply.status(201).send({
      consent: {
        type: record.type,
        version: record.version,
        granted: record.granted,
        grantedAt: record.grantedAt,
        revokedAt: record.revokedAt,
        source: record.source,
      },
    });
  });

  // --- KVKK subject rights -------------------------------------------------

  /**
   * Data portability (KVKK m.11). Served as a downloadable attachment rather than a
   * bare JSON body: the right is to RECEIVE the data, and a filename is what makes
   * the response a portable artefact rather than a debugging view.
   */
  app.get('/me/export', async (request, reply) => {
    const data = await safety.exportUserData(request.userId);
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="habitwar-export-${stamp}.json"`)
      // The export contains the whole account; no cache may hold a copy of it.
      .header('cache-control', 'no-store')
      .send(data);
  });

  /**
   * Erasure (KVKK m.7). Soft delete plus a retention window — the service explains
   * why an immediate hard delete would destroy third parties' aggregates and the
   * user's own appeal evidence.
   *
   * 202, not 204: the request is accepted and the account is dead to the user
   * immediately, but the erasure completes when the purge job runs. Answering 204
   * would claim a finality the system has not reached.
   */
  app.delete('/me', async (request, reply) => {
    // Zod's `.optional()` accepts a missing body; a present body must still confirm.
    deleteAccountBody.parse(request.body ?? undefined);

    const result = await safety.requestAccountDeletion(request.userId);

    request.log.info(
      { userId: request.userId, purgeEligibleAt: result.purgeEligibleAt },
      'account deletion requested',
    );

    return reply.status(202).send({
      deletedAt: result.deletedAt,
      purgeEligibleAt: result.purgeEligibleAt,
      retentionDays: result.retentionDays,
      message:
        'Your account has been deactivated and your session is no longer valid. ' +
        `Your data is permanently erased after ${result.retentionDays} days.`,
    });
  });
}

/**
 * The client address as Fastify resolved it. `trustProxy` is on in server.ts, so this
 * is the real client rather than the load balancer.
 *
 * Truncated to 45 characters to match `ConsentRecord.ipAddress @db.VarChar(45)` (the
 * maximum length of an IPv6 address with an embedded IPv4 suffix), so a proxy sending
 * something unexpected cannot turn a consent write into a 500.
 */
function clientIp(request: FastifyRequest): string | undefined {
  return request.ip ? request.ip.slice(0, 45) : undefined;
}

/** Truncated to match `ConsentRecord.userAgent @db.VarChar(300)`, for the same reason. */
function userAgent(request: FastifyRequest): string | undefined {
  const header = request.headers['user-agent'];
  const value = Array.isArray(header) ? header[0] : header;
  return value ? value.slice(0, 300) : undefined;
}
