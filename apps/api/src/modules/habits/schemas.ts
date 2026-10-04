import { COUNT_TARGET_MAX } from '@habitwar/domain';
import { z } from 'zod';

const CATEGORIES = [
  'FITNESS',
  'STUDY',
  'MINDFULNESS',
  'CREATIVE',
  'SOCIAL',
  'HEALTH',
  'SKILL',
] as const;

const STATS = ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX'] as const;

const habitFields = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(CATEGORIES),
  /** Optional stat override; validated against the category by the service. */
  stat: z.enum(STATS).optional(),
  targetMinutes: z.number().int().min(1).max(480),
  frequency: z.enum(['DAILY', 'WEEKLY', 'CUSTOM']).default('DAILY'),
  colorHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'colorHex must be a #RRGGBB value')
    .default('#6366F1'),
  /** TIMED (the timer) or COUNT (quick taps toward a daily target). */
  kind: z.enum(['TIMED', 'COUNT']).default('TIMED'),
  targetCount: z.number().int().min(1).max(COUNT_TARGET_MAX).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
});

/** A count habit must say what it counts to; a timed one carries no count fields. */
export const createHabitBody = habitFields.refine(
  (body) => body.kind !== 'COUNT' || (body.targetCount !== undefined && body.unit !== undefined),
  { message: 'A COUNT habit needs targetCount and unit', path: ['targetCount'] },
);

export const updateHabitBody = habitFields.partial();

export const habitIdParams = z.object({ id: z.string().cuid() });

export type CreateHabitBody = z.infer<typeof createHabitBody>;
export type UpdateHabitBody = z.infer<typeof updateHabitBody>;
