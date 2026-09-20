/**
 * Friendship, follow and user-search routes.
 *
 * Every handler acts as `request.userId` and takes no user id from the client: the
 * only identity the caller can name is a *target* username, never a subject. That is
 * what keeps "remove friendship X" from becoming "remove anyone's friendship X".
 *
 * Bodies and params are parsed with Zod rather than Fastify's JSON schema, matching
 * the other modules, so parsed types flow into the service without a second set of
 * hand-written interfaces.
 */

import type { FastifyInstance } from 'fastify';

import { FriendService } from './service.js';
import {
  followUsernameParams,
  friendTargetBody,
  friendshipIdParams,
  userSearchQuery,
} from './schemas.js';

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  const friends = new FriendService({ prisma: app.prisma, now: () => new Date() });

  app.addHook('preHandler', app.requireUser);

  app.get('/friends', async (request) => {
    return { friends: await friends.listFriends(request.userId) };
  });

  app.get('/friends/requests', async (request) => {
    return friends.listRequests(request.userId);
  });

  app.post('/friends/request', async (request, reply) => {
    const body = friendTargetBody.parse(request.body);
    const result = await friends.requestByUsername(request.userId, body.username);
    // 200 for the mutual-request case, 201 for a newly created pending row: the
    // request either produced a friendship that already half-existed, or a new
    // resource. The client needs to tell those apart to render the right message.
    return reply
      .status(result.autoAccepted ? 200 : 201)
      .send({ friendship: result.friendship, autoAccepted: result.autoAccepted });
  });

  app.post('/friends/:id/accept', async (request) => {
    const { id } = friendshipIdParams.parse(request.params);
    return { friendship: await friends.accept(request.userId, id) };
  });

  app.post('/friends/:id/decline', async (request, reply) => {
    const { id } = friendshipIdParams.parse(request.params);
    await friends.decline(request.userId, id);
    return reply.status(204).send();
  });

  app.delete('/friends/:id', async (request, reply) => {
    const { id } = friendshipIdParams.parse(request.params);
    await friends.remove(request.userId, id);
    return reply.status(204).send();
  });

  app.post('/follows', async (request, reply) => {
    const body = friendTargetBody.parse(request.body);
    const result = await friends.follow(request.userId, body.username);
    // 201 even when the follow already existed: the operation is idempotent and the
    // caller's end state is the same either way.
    return reply.status(201).send(result);
  });

  app.delete('/follows/:username', async (request, reply) => {
    const { username } = followUsernameParams.parse(request.params);
    await friends.unfollow(request.userId, username);
    return reply.status(204).send();
  });

  app.get('/users/search', async (request) => {
    const { q, limit } = userSearchQuery.parse(request.query);
    return { users: await friends.searchUsers(request.userId, q, limit) };
  });
}
