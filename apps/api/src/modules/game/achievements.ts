/**
 * Badges — catalogue, sync and evaluation.
 *
 * WHY THE CATALOGUE LIVES IN CODE AND NOT IN THE DATABASE
 *
 * `Achievement` is a table, but it is seeded data, not user data, and the table is
 * not where a badge is *defined* — it is where a badge is *registered* so that
 * `UserAchievement` has something to point a foreign key at. The definition lives
 * here for four reasons:
 *
 *  1. A badge is only half data. Its unlock rule is a predicate over the user's
 *     state, and a predicate cannot be a row. The schema's `criteria` Json field
 *     gestures at a generic rule interpreter, but a hand-written interpreter over
 *     Json is a worse-typed, worse-tested reimplementation of TypeScript. Keeping
 *     the threshold next to the function that reads it means the two cannot drift.
 *  2. `UserAchievement.achievement` is `onDelete: Restrict` — a badge definition
 *     users already hold cannot be deleted. That makes the definition set a
 *     migration-like artefact, and migration-like artefacts belong in version
 *     control where they are reviewed, diffed and rolled back, not in rows an
 *     operator can edit at 3am.
 *  3. The award path must be able to name a badge. `AchievementCode` is a union
 *     type, so a typo in a badge reference is a compile error rather than a silent
 *     no-op in production.
 *  4. Every environment agrees. A badge that exists in staging and not in production
 *     is a class of bug that simply cannot occur when the catalogue ships with the
 *     code.
 *
 * The table is kept in step by `syncAchievementCatalog`, which is idempotent and
 * retires rather than deletes — see its own comment.
 */

import type {
  AchievementCategory,
  AchievementTier,
  Prisma,
  PrismaClient,
  UserAchievement,
} from '@prisma/client';
import { levelProgress } from '@habitwar/domain';

/**
 * Stable badge identities. Referenced by the award path, so they are a type, not
 * strings: renaming a badge's display name must never break the rule that grants it,
 * and mistyping a code must not compile.
 */
export const ACHIEVEMENT_CODES = [
  'first_session',
  'streak_7',
  'streak_30',
  'level_10',
  'level_25',
  'xp_1000',
  'xp_10000',
  'first_friend',
  'friends_5',
  'first_duel_win',
] as const;

export type AchievementCode = (typeof ACHIEVEMENT_CODES)[number];

/**
 * The metric a badge is measured on. Each one maps to exactly one number computed by
 * `collectMetrics`, which is what keeps evaluation a single query pass rather than
 * one query per badge.
 */
export type AchievementMetric =
  | 'completedSessions'
  | 'longestStreak'
  | 'level'
  | 'lifetimeXp'
  | 'friends'
  | 'duelWins';

export interface AchievementDefinition {
  readonly code: AchievementCode;
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly tier: AchievementTier;
  readonly metric: AchievementMetric;
  /** Unlocks when the metric reaches this value (>=). */
  readonly threshold: number;
  /** XP granted on unlock. Awarded through XpLedger, never by writing cycleXp. */
  readonly xpReward: number;
  readonly isSecret: boolean;
}

/**
 * The catalogue.
 *
 * Tiers escalate with the effort behind them, and XP rewards stay deliberately small
 * relative to the level curve (level 10 costs ~1,900 cycle XP): a badge should mark
 * progress, not be a faster route to levels than the habits themselves.
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  {
    code: 'first_session',
    name: 'First Steps',
    description: 'Complete your first session.',
    category: 'MILESTONE',
    tier: 'BRONZE',
    metric: 'completedSessions',
    threshold: 1,
    xpReward: 25,
    isSecret: false,
  },
  {
    code: 'streak_7',
    name: 'Week One',
    description: 'Reach a 7-day streak on any habit.',
    category: 'STREAK',
    tier: 'BRONZE',
    metric: 'longestStreak',
    threshold: 7,
    xpReward: 50,
    isSecret: false,
  },
  {
    code: 'streak_30',
    name: 'Thirty Days',
    description: 'Reach a 30-day streak on any habit.',
    category: 'STREAK',
    tier: 'GOLD',
    metric: 'longestStreak',
    threshold: 30,
    xpReward: 250,
    isSecret: false,
  },
  {
    code: 'level_10',
    name: 'Class Awakening',
    description: 'Reach level 10 and unlock your class.',
    category: 'MILESTONE',
    tier: 'SILVER',
    metric: 'level',
    threshold: 10,
    xpReward: 100,
    isSecret: false,
  },
  {
    code: 'level_25',
    name: 'Seasoned',
    description: 'Reach level 25.',
    category: 'MILESTONE',
    tier: 'GOLD',
    metric: 'level',
    threshold: 25,
    xpReward: 300,
    isSecret: false,
  },
  {
    code: 'xp_1000',
    name: 'A Thousand Strong',
    description: 'Earn 1,000 lifetime XP.',
    category: 'MILESTONE',
    tier: 'BRONZE',
    metric: 'lifetimeXp',
    threshold: 1_000,
    xpReward: 50,
    isSecret: false,
  },
  {
    code: 'xp_10000',
    name: 'Ten Thousand Hours',
    description: 'Earn 10,000 lifetime XP.',
    category: 'MILESTONE',
    tier: 'PLATINUM',
    metric: 'lifetimeXp',
    threshold: 10_000,
    xpReward: 500,
    isSecret: false,
  },
  {
    code: 'first_friend',
    name: 'Not Alone',
    description: 'Make your first friend.',
    category: 'SOCIAL',
    tier: 'BRONZE',
    metric: 'friends',
    threshold: 1,
    xpReward: 25,
    isSecret: false,
  },
  {
    code: 'friends_5',
    name: 'Party of Five',
    description: 'Have five friends.',
    category: 'SOCIAL',
    tier: 'SILVER',
    metric: 'friends',
    threshold: 5,
    xpReward: 100,
    isSecret: false,
  },
  {
    code: 'first_duel_win',
    name: 'First Blood',
    description: 'Win your first duel.',
    category: 'CHALLENGE',
    tier: 'SILVER',
    metric: 'duelWins',
    threshold: 1,
    xpReward: 100,
    isSecret: false,
  },
];

const CATALOG_BY_CODE: ReadonlyMap<AchievementCode, AchievementDefinition> = new Map(
  ACHIEVEMENT_CATALOG.map((definition) => [definition.code, definition]),
);

/** Every metric the catalogue can be evaluated against, computed once per user. */
export type AchievementMetrics = Readonly<Record<AchievementMetric, number>>;

export interface AchievementProgressView {
  readonly code: AchievementCode;
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly tier: AchievementTier;
  readonly xpReward: number;
  readonly isSecret: boolean;
  readonly threshold: number;
  /** The user's current value for this badge's metric, capped at the threshold. */
  readonly progress: number;
  readonly unlocked: boolean;
  readonly unlockedAt: Date | null;
}

export interface AchievementsView {
  readonly achievements: readonly AchievementProgressView[];
  readonly unlockedCount: number;
  readonly totalCount: number;
}

/** Injectable clock, matching `modules/sessions/service.ts`. */
export type Clock = () => Date;

/**
 * Brings the Achievement table in line with the catalogue. Idempotent: safe to run on
 * every boot, in a migration, or from a seed script.
 *
 * Upserts by `code` (the stable identity) rather than by id, so a row's cuid — and
 * therefore every `UserAchievement.achievementId` pointing at it — survives.
 *
 * Rows whose code has left the catalogue are RETIRED (`isActive = false`), never
 * deleted: `UserAchievement.achievement` is `onDelete: Restrict`, so deleting a badge
 * somebody earned would fail loudly at the database — correctly — and a badge nobody
 * earned still should not silently vanish from a user's collection view. Retirement
 * stops it being awarded while keeping it readable.
 *
 * `criteria` is written as the machine-readable mirror of the in-code rule so the
 * column is not left meaningless, but nothing reads it back: `evaluateAchievements`
 * evaluates the typed catalogue, not this Json.
 */
export async function syncAchievementCatalog(prisma: PrismaClient): Promise<{
  synced: number;
  retired: number;
}> {
  for (const definition of ACHIEVEMENT_CATALOG) {
    const criteria: Prisma.InputJsonValue = {
      metric: definition.metric,
      threshold: definition.threshold,
    };
    const fields = {
      name: definition.name,
      description: definition.description,
      category: definition.category,
      tier: definition.tier,
      criteria,
      xpReward: definition.xpReward,
      isSecret: definition.isSecret,
      isActive: true,
    };
    await prisma.achievement.upsert({
      where: { code: definition.code },
      create: { code: definition.code, ...fields },
      update: fields,
    });
  }

  const retired = await prisma.achievement.updateMany({
    where: { code: { notIn: [...ACHIEVEMENT_CODES] }, isActive: true },
    data: { isActive: false },
  });

  return { synced: ACHIEVEMENT_CATALOG.length, retired: retired.count };
}

/**
 * Everything the catalogue measures, in one pass.
 *
 * Counted from the tables that own each fact rather than from denormalised columns
 * where the two could disagree — except `level`, which is derived from `cycleXp`
 * through the domain's own curve rather than read from `User.level`, since that
 * column is explicitly documented as a sort cache.
 *
 * Flagged sessions are excluded from the session count for the same reason they are
 * excluded from duels: a badge is a ranking of a kind, and §4 keeps flagged work out
 * of rankings.
 */
export async function collectMetrics(
  prisma: PrismaClient,
  userId: string,
): Promise<AchievementMetrics> {
  const [user, completedSessions, longestStreakRow, friends, duelWins] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { cycleXp: true, lifetimeXp: true },
    }),
    prisma.session.count({ where: { userId, status: 'COMPLETED', isFlagged: false } }),
    prisma.habit.findFirst({
      where: { userId },
      orderBy: { longestStreak: 'desc' },
      select: { longestStreak: true },
    }),
    // Friend counts must ignore soft-deleted accounts on the other side, or a user's
    // badge progress would include people who no longer exist to them.
    prisma.friendship.count({
      where: {
        status: 'ACCEPTED',
        OR: [
          { requesterId: userId, addressee: { is: { deletedAt: null } } },
          { addresseeId: userId, requester: { is: { deletedAt: null } } },
        ],
      },
    }),
    prisma.challenge.count({ where: { winnerId: userId, status: 'COMPLETED' } }),
  ]);

  return {
    completedSessions,
    longestStreak: longestStreakRow?.longestStreak ?? 0,
    // lifetimeXp is a BigInt column; Number is safe here because the thresholds are
    // small and a comparison against 10,000 does not need 64-bit precision.
    lifetimeXp: user ? Number(user.lifetimeXp) : 0,
    level: user ? levelProgress(user.cycleXp).level : 1,
    friends,
    duelWins,
  };
}

export interface EvaluateResult {
  readonly unlocked: readonly AchievementCode[];
  readonly xpAwarded: number;
}

/**
 * Grants every badge the user has earned but does not yet hold.
 *
 * Deliberately NOT wired into the session-completion path: that path is the hottest
 * correctness surface in the product and owns a single transaction that must stay
 * cheap. This function is exported for a caller — the completion flow, a background
 * job, or a test — to invoke once that integration is designed. It is safe to call
 * at any time and on any schedule, because it is idempotent.
 *
 * Idempotency rests on `@@unique([userId, achievementId])`: concurrent calls race to
 * the same row and the loser's create fails with P2002, which is swallowed. That is
 * why each badge is written in its own small transaction rather than one large one —
 * a single conflicting row must not roll back the badges that did land.
 *
 * The badge's XP reward goes through XpLedger and `User.cycleXp` together, the same
 * discipline the session path follows: nothing may increment a total without leaving
 * a ledger row to explain it.
 */
export async function evaluateAchievements(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<EvaluateResult> {
  const metrics = await collectMetrics(prisma, userId);

  // Only badges that are both catalogued and registered-and-active can be awarded:
  // the foreign key needs a row, and a retired row must stop granting.
  const rows = await prisma.achievement.findMany({
    where: { code: { in: [...ACHIEVEMENT_CODES] }, isActive: true },
    select: { id: true, code: true, xpReward: true },
  });

  const held = new Set(
    (
      await prisma.userAchievement.findMany({
        where: { userId, achievementId: { in: rows.map((row) => row.id) } },
        select: { achievementId: true },
      })
    ).map((row) => row.achievementId),
  );

  const unlocked: AchievementCode[] = [];
  let xpAwarded = 0;

  for (const row of rows) {
    if (held.has(row.id)) continue;

    const definition = CATALOG_BY_CODE.get(row.code as AchievementCode);
    if (!definition) continue;

    const value = metrics[definition.metric];
    if (value < definition.threshold) continue;

    const granted = await grantAchievement(prisma, {
      userId,
      achievementId: row.id,
      code: definition.code,
      xpReward: row.xpReward,
      progress: { value, threshold: definition.threshold },
      now,
    });
    if (granted) {
      unlocked.push(definition.code);
      xpAwarded += row.xpReward;
    }
  }

  return { unlocked, xpAwarded };
}

interface GrantInput {
  readonly userId: string;
  readonly achievementId: string;
  readonly code: AchievementCode;
  readonly xpReward: number;
  readonly progress: { value: number; threshold: number };
  readonly now: Date;
}

/** Writes one unlock plus its XP reward. Returns false if the badge was already held. */
async function grantAchievement(prisma: PrismaClient, input: GrantInput): Promise<boolean> {
  const { userId, achievementId, code, xpReward, progress, now } = input;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.userAchievement.create({
        data: {
          userId,
          achievementId,
          unlockedAt: now,
          progress: progress as unknown as Prisma.InputJsonValue,
        },
      });

      if (xpReward > 0) {
        await tx.xpLedger.create({
          data: {
            userId,
            amount: xpReward,
            reason: 'MANUAL_ADJUSTMENT',
            note: `Achievement unlocked: ${code}`,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            cycleXp: { increment: xpReward },
            lifetimeXp: { increment: BigInt(xpReward) },
          },
        });
        // User.level is intentionally left alone: it is a sort cache derived from
        // cycleXp, and recomputing it here would duplicate the session path's
        // level logic in a second place. The next session completion refreshes it,
        // and every read path derives the level through levelProgress anyway.
      }
    });
    return true;
  } catch (error) {
    // P2002 is the unique constraint on (userId, achievementId) — another call won
    // the race. That is the designed outcome, not a failure.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * GET /v1/achievements — the whole catalogue plus what this user holds.
 *
 * Secret badges the user has not unlocked are omitted entirely rather than shown
 * redacted; a greyed-out "???" is still a disclosure that something is there.
 */
export async function listAchievements(
  prisma: PrismaClient,
  userId: string,
): Promise<AchievementsView> {
  const [metrics, held] = await Promise.all([
    collectMetrics(prisma, userId),
    prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: { select: { code: true } } },
    }),
  ]);

  const unlockedAtByCode = new Map<string, Date>(
    held.map((row: UserAchievement & { achievement: { code: string } }) => [
      row.achievement.code,
      row.unlockedAt,
    ]),
  );

  const achievements = ACHIEVEMENT_CATALOG.filter(
    (definition) => !definition.isSecret || unlockedAtByCode.has(definition.code),
  ).map((definition): AchievementProgressView => {
    const unlockedAt = unlockedAtByCode.get(definition.code) ?? null;
    return {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      tier: definition.tier,
      xpReward: definition.xpReward,
      isSecret: definition.isSecret,
      threshold: definition.threshold,
      progress: Math.min(metrics[definition.metric], definition.threshold),
      unlocked: unlockedAt !== null,
      unlockedAt,
    };
  });

  return {
    achievements,
    unlockedCount: achievements.filter((entry) => entry.unlocked).length,
    totalCount: achievements.length,
  };
}
