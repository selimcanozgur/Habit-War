/**
 * Game routes — duels, badges, seasons.
 *
 * Bodies are parsed with Zod rather than Fastify's JSON schema, so the parsed types
 * flow into the services without a second set of hand-written interfaces — the same
 * convention `modules/sessions/routes.ts` follows.
 */

import type { FastifyInstance } from 'fastify';

import { ChallengeService } from './challenges.js';
import { listAchievements } from './achievements.js';
import { SeasonService } from './seasons.js';
import { challengeIdParams, createChallengeBody, listChallengesQuery } from './schemas.js';

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  const now = (): Date => new Date();
  const challenges = new ChallengeService({ prisma: app.prisma, now });
  const seasons = new SeasonService({ prisma: app.prisma, now });

  app.addHook('preHandler', app.requireUser);

  app.get('/challenges', async (request) => {
    const query = listChallengesQuery.parse(request.query);
    const { active, past } = await challenges.list(request.userId, query.limit);

    // One handler, three shapes: the duel screen wants only live duels, the history
    // tab only finished ones. Returning both keys always would make the client
    // filter a list it already asked the server to narrow.
    if (query.scope === 'active') return { active, past: [] };
    if (query.scope === 'past') return { active: [], past };
    return { active, past };
  });

  app.post('/challenges', async (request, reply) => {
    const body = createChallengeBody.parse(request.body);
    const challenge = await challenges.create({
      userId: request.userId,
      opponentUsername: body.opponentUsername,
      category: body.category,
      days: body.days,
    });
    return reply.status(201).send({ challenge });
  });

  app.post('/challenges/:id/accept', async (request) => {
    const { id } = challengeIdParams.parse(request.params);
    return { challenge: await challenges.accept(request.userId, id) };
  });

  app.post('/challenges/:id/decline', async (request) => {
    const { id } = challengeIdParams.parse(request.params);
    return { challenge: await challenges.decline(request.userId, id) };
  });

  app.get('/achievements', async (request) => {
    return listAchievements(app.prisma, request.userId);
  });

  app.get('/seasons/current', async () => {
    return seasons.current();
  });
}
