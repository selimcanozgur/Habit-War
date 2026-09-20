/**
 * Profile, analytics and leaderboard routes.
 *
 * `/users/me*` is registered BEFORE `/users/:username`. Fastify's router prefers a
 * static segment over a parametric one, so the order is not strictly load-bearing —
 * but stating it explicitly keeps the intent obvious to the next reader, who would
 * otherwise have to know that detail to be sure `me` is not treated as a username.
 * (`usernameParams` would reject "me" anyway: it is below the 3-character minimum.)
 *
 * There is NO global leaderboard route here, deliberately — see
 * ProfileService.friendsLeaderboard for the argument.
 */

import type { FastifyInstance } from 'fastify';

import { ProfileService } from './service.js';
import {
  leaderboardQuery,
  selectClassBody,
  statsQuery,
  updateProfileBody,
  usernameParams,
} from './schemas.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  const profiles = new ProfileService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/users/me', async (request) => {
    return { user: await profiles.getOwnProfile(request.userId) };
  });

  app.patch('/users/me', async (request) => {
    const body = updateProfileBody.parse(request.body);
    return { user: await profiles.updateOwnProfile(request.userId, body) };
  });

  app.get('/users/me/stats', async (request) => {
    const { period } = statsQuery.parse(request.query);
    return { stats: await profiles.getStats(request.userId, period) };
  });

  app.post('/users/me/class', async (request) => {
    const { classType } = selectClassBody.parse(request.body);
    return { user: await profiles.selectClass(request.userId, classType) };
  });

  app.get('/leaderboard/friends', async (request) => {
    const { limit } = leaderboardQuery.parse(request.query);
    return { leaderboard: await profiles.friendsLeaderboard(request.userId, limit) };
  });

  // Parametric route last. Authenticated like every other route: an anonymous profile
  // read could not evaluate the block filter, and a public profile that ignores blocks
  // is a block that does not work.
  app.get('/users/:username', async (request) => {
    const { username } = usernameParams.parse(request.params);
    return { user: await profiles.getPublicProfile(request.userId, username) };
  });
}
