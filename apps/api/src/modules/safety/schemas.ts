/**
 * Moderation, blocking and KVKK request contracts.
 *
 * Three of these endpoints are not product features — they are compliance surfaces:
 *
 *  - Block and Report exist because App Store Guideline 1.2 requires a user-generated
 *    content app to ship a reporting mechanism, a blocking mechanism and a documented
 *    moderation response. The audit recorded the absence of all three as a direct
 *    rejection risk.
 *  - ConsentRecord exists because KVKK art. 4 puts the burden of PROVING consent on
 *    the controller, and art. 6 requires separate explicit consent for
 *    special-category data (heart rate, steps).
 *
 * As in the friends module, every reference to another person is by `username`, never
 * by id or email: a stranger's cuid is unknowable to a client, and an endpoint that
 * confirms "this email has an account" is an account-enumeration oracle regardless of
 * what it returns.
 */

import { z } from 'zod';

/**
 * Mirrors the normalisation in modules/users/service.ts (`[a-z0-9_]`, 3-20 chars), so
 * a malformed handle is rejected here rather than coming back as an ambiguous 404.
 */
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/, 'username may contain only letters, digits and underscores');

/** Kept in sync with the ReportReason enum in prisma/schema.prisma. */
const REPORT_REASONS = [
  'SPAM',
  'HARASSMENT',
  'HATE_SPEECH',
  'SEXUAL_CONTENT',
  'VIOLENCE',
  'SELF_HARM',
  'IMPERSONATION',
  'CHEATING',
  'INTELLECTUAL_PROPERTY',
  'OTHER',
] as const;

/** Kept in sync with the ConsentType enum in prisma/schema.prisma. */
const CONSENT_TYPES = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'HEALTH_DATA',
  'MARKETING_EMAIL',
  'PUSH_NOTIFICATIONS',
  'ANALYTICS',
  'DATA_SHARING_SOCIAL',
  'AGE_CONFIRMATION',
] as const;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const blockTargetBody = z.object({
  username,
  /**
   * Optional: a block is not an accusation and must never require one. The reason,
   * when offered, feeds the moderation team's pattern analysis (Block.reason).
   */
  reason: z.enum(REPORT_REASONS).optional(),
});

export const blockUsernameParams = z.object({ username });

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * `targetType` + `targetId` collapse the schema's `postId` / `reportedUserId` pair
 * into one client-facing shape. The service is what maps it back onto exactly one
 * column: Report's XOR is an application invariant because Prisma cannot express a
 * check constraint, so it is enforced in exactly one place rather than trusted to the
 * client's choice of fields.
 *
 * A USER report carries a username; a POST report carries the post's cuid, which the
 * client legitimately has because it rendered the post.
 */
export const createReportBody = z
  .object({
    targetType: z.enum(['POST', 'USER']),
    targetId: z.string().trim().min(1).max(64),
    reason: z.enum(REPORT_REASONS),
    /** Free-text elaboration. 1000 chars mirrors `Report.details @db.VarChar(1000)`. */
    detail: z.string().trim().min(1).max(1000).optional(),
  })
  .superRefine((body, ctx) => {
    // Shape-check the id against what the target type can actually be addressed by,
    // so a swapped pair fails as a 400 here rather than as a confusing 404 later.
    if (body.targetType === 'USER' && !/^[a-z0-9_]{3,20}$/.test(body.targetId.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetId'],
        message: 'targetId must be a username when targetType is USER',
      });
    }
    if (body.targetType === 'POST' && !/^c[a-z0-9]{20,}$/.test(body.targetId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetId'],
        message: 'targetId must be a post id when targetType is POST',
      });
    }
  });

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * `version` is mandatory and carries no default on purpose. Consent to v1 of a
 * privacy notice is not consent to v2; a server-side default would silently
 * re-attribute agreement the user never gave to whatever text is current.
 *
 * `granted: false` is a withdrawal, which KVKK art. 7 makes as much a right as the
 * grant. It is recorded, never erased — see the service.
 */
export const recordConsentBody = z.object({
  type: z.enum(CONSENT_TYPES),
  version: z.string().trim().min(1).max(40),
  granted: z.boolean(),
  /** Where the consent was collected ("onboarding", "settings.health", ...). */
  source: z.string().trim().min(1).max(60).optional(),
});

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

/**
 * Deletion is irreversible from the user's point of view and must not be triggerable
 * by a stray DELETE. The typed confirmation is the same pattern every destructive
 * console action uses, and it is cheap insurance against a client bug wiping an
 * account nobody asked to wipe.
 */
export const deleteAccountBody = z
  .object({
    confirm: z.literal('DELETE'),
    /** Optional free-text reason, retained only in the log, never on the user row. */
    reason: z.string().trim().max(500).optional(),
  })
  .optional();

export type BlockTargetBody = z.infer<typeof blockTargetBody>;
export type CreateReportBody = z.infer<typeof createReportBody>;
export type RecordConsentBody = z.infer<typeof recordConsentBody>;
export type DeleteAccountBody = z.infer<typeof deleteAccountBody>;
