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

export const createHabitBody = z.object({
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
});

export const updateHabitBody = createHabitBody.partial();

export const habitIdParams = z.object({ id: z.string().cuid() });

export type CreateHabitBody = z.infer<typeof createHabitBody>;
export type UpdateHabitBody = z.infer<typeof updateHabitBody>;
