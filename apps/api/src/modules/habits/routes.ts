/**
 * Habit CRUD.
 *
 * DELETE archives rather than destroys: sessions reference the habit and a user's XP
 * history must stay explainable. Real erasure belongs to the account-deletion flow,
 * where it is a deliberate, auditable act rather than a side effect of tidying a list.
 */

import type { FastifyInstance } from 'fastify';
import { isStatAllowedForCategory, resolveStat, type Category, type Stat } from '@habitwar/domain';

import { unprocessable, notFound } from '../../lib/errors.js';
import { definedOnly } from '../../lib/objects.js';
import { createHabitBody, habitIdParams, updateHabitBody } from './schemas.js';

export async function habitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireUser);

  app.get('/habits', async (request) => {
    const habits = await app.prisma.habit.findMany({
      where: { userId: request.userId, isArchived: false },
      orderBy: { createdAt: 'asc' },
    });
    return { habits };
  });

  app.post('/habits', async (request, reply) => {
    const body = createHabitBody.parse(request.body);
    assertStatFitsCategory(body.category, body.stat);

    const habit = await app.prisma.habit.create({
      data: {
        userId: request.userId,
        name: body.name,
        category: body.category,
        stat: body.stat ?? resolveStat(body.category),
        targetMinutes: body.targetMinutes,
        frequency: body.frequency,
        colorHex: body.colorHex,
      },
    });
    return reply.status(201).send({ habit });
  });

  app.patch('/habits/:id', async (request) => {
    const { id } = habitIdParams.parse(request.params);
    const body = updateHabitBody.parse(request.body);

    const existing = await app.prisma.habit.findFirst({ where: { id, userId: request.userId } });
    if (!existing) throw notFound('Habit not found');

    const category = (body.category ?? existing.category) as Category;
    assertStatFitsCategory(category, body.stat as Stat | undefined);

    const habit = await app.prisma.habit.update({ where: { id }, data: definedOnly(body) });
    return { habit };
  });

  app.delete('/habits/:id', async (request) => {
    const { id } = habitIdParams.parse(request.params);
    const existing = await app.prisma.habit.findFirst({ where: { id, userId: request.userId } });
    if (!existing) throw notFound('Habit not found');

    const habit = await app.prisma.habit.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    return { habit };
  });
}

function assertStatFitsCategory(category: Category, stat?: Stat | undefined): void {
  if (stat && !isStatAllowedForCategory(category, stat)) {
    throw unprocessable(`Stat ${stat} is not valid for category ${category}`, { category, stat });
  }
}
