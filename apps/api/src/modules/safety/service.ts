/**
 * Safety — blocking, reporting, consent and KVKK subject rights.
 *
 * This module is what makes the app shippable and lawful, and neither half is
 * optional:
 *
 *  - App Store Guideline 1.2 requires a UGC app to ship a reporting mechanism, a
 *    blocking mechanism, and a documented moderation response. The spec audit
 *    recorded the absence of all three as a direct rejection.
 *  - KVKK gives the data subject the rights this module implements: art. 11 (access
 *    and portability — `exportUserData`), art. 7 (erasure — `requestAccountDeletion`),
 *    and art. 4/6 (provable, purpose-separated explicit consent — `recordConsent`).
 *
 * Two invariants live here because they live nowhere else:
 *
 *  1. A block is SYMMETRIC IN VISIBILITY even though the row is directional. If A
 *     blocks B, neither may see the other. Hiding only one direction leaks the fact
 *     of the block back to the blocked user, which is precisely what a block is for.
 *     `blockedUserIds()` is the single helper every other module must filter on.
 *  2. Report's `postId` / `reportedUserId` XOR. Prisma cannot express a check
 *     constraint, so the database will happily store a row with both or neither set.
 *     `createReport` is the only writer and it enforces the XOR structurally — the
 *     two columns are never both assignable from one code path.
 */

import type { Prisma, PrismaClient, Block, ConsentRecord, Report } from '@prisma/client';
import type { ConsentType, ReportReason } from '@prisma/client';

import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { softDeleteUser } from '../users/service.js';

/** Injectable clock — keeps the service deterministic under test. */
export type Clock = () => Date;

export interface SafetyServiceDeps {
  readonly prisma: PrismaClient;
  readonly now: Clock;
}

/**
 * How long a soft-deleted account is retained before the purge job may hard-delete it.
 *
 * Erasure is honoured immediately from the user's side — the account is soft-deleted,
 * the session is dead (plugins/auth.ts rejects a row with `deletedAt` set with a 403,
 * in both auth modes), and the profile stops being reachable. The ROW survives the
 * window because other users' aggregates were computed from these sessions and an XP
 * correction the user may still contest is evidenced by them; a same-second hard
 * delete would destroy the basis of somebody else's leaderboard position and of the
 * user's own appeal under KVKK art. 11(g).
 *
 * 30 days is the shortest window that outlives a monthly league cycle and the appeal
 * path, and it is short enough to stay defensible as "without undue delay". The purge
 * job that consumes this constant is not written yet — see the module's known gaps.
 */
export const ACCOUNT_ERASURE_RETENTION_DAYS = 30;

export interface BlockedUserView {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly blockedAt: Date;
  readonly reason: ReportReason | null;
}

export interface ConsentView {
  readonly type: ConsentType;
  readonly version: string;
  readonly granted: boolean;
  readonly grantedAt: Date;
  readonly revokedAt: Date | null;
  readonly source: string | null;
}

export interface CreateReportInput {
  readonly reporterId: string;
  readonly targetType: 'POST' | 'USER';
  readonly targetId: string;
  readonly reason: ReportReason;
  readonly detail?: string | undefined;
}

export interface RecordConsentInput {
  readonly userId: string;
  readonly type: ConsentType;
  readonly version: string;
  readonly granted: boolean;
  readonly source?: string | undefined;
  /** Evidence of the act of consent, for the KVKK art. 4 burden of proof. */
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface AccountDeletionResult {
  readonly deletedAt: Date;
  /** When the purge job becomes free to hard-delete the row. */
  readonly purgeEligibleAt: Date;
  readonly retentionDays: number;
}

export class SafetyService {
  readonly #prisma: PrismaClient;
  readonly #now: Clock;

  constructor({ prisma, now }: SafetyServiceDeps) {
    this.#prisma = prisma;
    this.#now = now;
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  /**
   * Blocks a user by username.
   *
   * The block, the termination of any friendship and the removal of any follow edge
   * happen in ONE transaction. Split across statements, a crash between them leaves a
   * blocked user still holding a friendship — which grants duels, peer verification
   * and a place in the friends feed, i.e. exactly the contact the block was meant to
   * end.
   *
   * Friendships are DELETED rather than moved to FriendshipStatus.BLOCKED. Block is
   * the model the product enforces (it works with no prior friendship), and leaving a
   * BLOCKED row behind would give the same pair two competing sources of truth, plus
   * a `pairKey` that blocks a legitimate future re-friend after an unblock.
   *
   * Idempotent: re-blocking someone already blocked returns the existing row rather
   * than a conflict. A client retrying after a dropped response must converge, and
   * "you already blocked them" is not an error the user can act on.
   */
  async blockUser(blockerId: string, username: string, reason?: ReportReason): Promise<Block> {
    const target = await this.#findActiveUserByUsername(username);

    // Self-blocking is nonsense that would make the user invisible to themselves once
    // the feed filters on blockedUserIds().
    if (target.id === blockerId) throw badRequest('You cannot block yourself');

    const existing = await this.#prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId: target.id } },
    });
    if (existing) return existing;

    const pairKey = friendshipPairKey(blockerId, target.id);

    const [block] = await this.#prisma.$transaction([
      this.#prisma.block.create({
        data: { blockerId, blockedId: target.id, reason: reason ?? null },
      }),

      // Terminates an accepted friendship AND clears a pending request in either
      // direction: `pairKey` is direction-free, so this one statement covers all
      // four states (A→B pending, B→A pending, accepted, none).
      this.#prisma.friendship.deleteMany({ where: { pairKey } }),

      // Follows are one-directional and separate from friendship, so both edges are
      // removed explicitly. A surviving follow would keep the blocked user's posts
      // arriving in the blocker's feed through the discovery path.
      this.#prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: target.id },
            { followerId: target.id, followingId: blockerId },
          ],
        },
      }),
    ]);

    return block;
  }

  /**
   * Removes a block. Idempotent — unblocking someone who is not blocked is a no-op,
   * for the same convergence reason as blockUser.
   *
   * Nothing is restored: the friendship and follow edges the block destroyed stay
   * destroyed. Silently re-friending two people because one of them lifted a block
   * would be a worse surprise than asking them to send a request again.
   */
  async unblockUser(blockerId: string, username: string): Promise<{ removed: boolean }> {
    // Deliberately not filtered on `deletedAt`: a user must be able to unblock an
    // account that has since been deleted, otherwise the row is stuck forever.
    const target = await this.#prisma.user.findUnique({ where: { username } });
    if (!target) throw notFound('User not found');

    const result = await this.#prisma.block.deleteMany({
      where: { blockerId, blockedId: target.id },
    });
    return { removed: result.count > 0 };
  }

  /**
   * The blocks this user issued, newest first.
   *
   * Only the blocker's own list is exposed. "Who has blocked me" is deliberately not
   * an endpoint: revealing it would defeat the block, which works precisely because
   * the blocked user is not told.
   */
  async listBlocks(blockerId: string): Promise<BlockedUserView[]> {
    const blocks = await this.#prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: { select: { username: true, displayName: true, avatarUrl: true } },
      },
    });

    return blocks.map((block) => ({
      username: block.blocked.username,
      displayName: block.blocked.displayName,
      avatarUrl: block.blocked.avatarUrl,
      blockedAt: block.createdAt,
      reason: block.reason,
    }));
  }

  /**
   * Every user id that must be invisible to `userId`, in BOTH directions.
   *
   * This is the helper the rest of the codebase filters on — feed, search, profile
   * reads, duel invitations, notification fan-out. Anything that returns another
   * user's content and does not consult it leaks around the block.
   *
   * Returns a Set because callers typically test membership per row, and a plain
   * array turns a feed page into a quadratic scan.
   */
  async blockedUserIds(userId: string): Promise<Set<string>> {
    const rows = await this.#prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });

    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }
    return ids;
  }

  /** True when a block exists in either direction. The pairwise form of the above. */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const found = await this.#prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });
    return found !== null;
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  /**
   * Files a report against a post or a user.
   *
   * The XOR between `postId` and `reportedUserId` is enforced structurally: the two
   * branches below each build a complete `data` object, so there is no code path that
   * can set both or neither. That is the whole enforcement — `schema.prisma` says the
   * database cannot check it, and this is the only writer.
   *
   * Repeat reports of the same target by the same reporter are refused while an
   * earlier one is still open. A moderation queue where one determined user can
   * enqueue the same complaint a thousand times is a queue that cannot meet a
   * response SLA, and Guideline 1.2 is assessed on the response, not the intake.
   */
  async createReport(input: CreateReportInput): Promise<Report> {
    const { reporterId, targetType, targetId, reason, detail } = input;

    // "Still open" = not yet decided. A DISMISSED or ACTION_TAKEN report does not
    // block a new one: the content may have been re-posted, or the situation may have
    // genuinely changed since the decision.
    const OPEN_STATUSES = ['PENDING', 'UNDER_REVIEW'] as const;

    let data: Prisma.ReportUncheckedCreateInput;

    if (targetType === 'POST') {
      const post = await this.#prisma.post.findFirst({
        where: { id: targetId, deletedAt: null },
        select: { id: true, authorId: true },
      });
      if (!post) throw notFound('Post not found');

      // Reporting your own post is always a client bug or an attempt to pad the
      // queue; there is nothing a moderator could do with it.
      if (post.authorId === reporterId) throw badRequest('You cannot report your own post');

      const open = await this.#prisma.report.findFirst({
        where: { reporterId, postId: post.id, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      });
      if (open) {
        throw conflict('You already have an open report for this post', { reportId: open.id });
      }

      // postId set, reportedUserId absent — the XOR, by construction.
      data = { reporterId, postId: post.id, reason, details: detail ?? null };
    } else {
      // Not filtered on `deletedAt`: a user must be able to report an account that
      // deleted itself mid-incident, which is the common shape of hit-and-run abuse.
      const target = await this.#prisma.user.findUnique({
        where: { username: targetId.toLowerCase() },
        select: { id: true },
      });
      if (!target) throw notFound('User not found');

      if (target.id === reporterId) throw badRequest('You cannot report yourself');

      const open = await this.#prisma.report.findFirst({
        where: { reporterId, reportedUserId: target.id, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      });
      if (open) {
        throw conflict('You already have an open report for this user', { reportId: open.id });
      }

      // reportedUserId set, postId absent — the other half of the XOR.
      data = { reporterId, reportedUserId: target.id, reason, details: detail ?? null };
    }

    return this.#prisma.report.create({ data });
  }

  // -------------------------------------------------------------------------
  // Consent — KVKK art. 4 (burden of proof) and art. 7 (withdrawal)
  // -------------------------------------------------------------------------

  /**
   * The user's consent history, newest first.
   *
   * The full history is returned, not just the current stance: the user's art. 11
   * right of access covers what they agreed to and when, and a UI that shows only
   * "marketing: off" cannot answer "what did I agree to in March".
   */
  async listConsents(userId: string): Promise<ConsentView[]> {
    const records = await this.#prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
      select: {
        type: true,
        version: true,
        granted: true,
        grantedAt: true,
        revokedAt: true,
        source: true,
      },
    });
    return records;
  }

  /**
   * Records a grant or a withdrawal. The table is append-only apart from `revokedAt`.
   *
   * The model, precisely:
   *
   *  - GRANT, no active record for (type, version): insert a new row. This is the
   *    proof artefact art. 4 requires.
   *  - GRANT, an active record already exists for (type, version): return it
   *    unchanged. Re-affirming the same text is not a new act of consent, and a new
   *    row per app launch would bury the real history in noise.
   *  - WITHDRAW: stamp `revokedAt` on every active record of that TYPE, across all
   *    versions. Scoping a withdrawal to one version would leave an older active
   *    grant standing and the user still consented to something they just refused.
   *  - GRANT after a withdrawal: a new row, because the earlier row is revoked and
   *    therefore no longer active.
   *
   * A grant is never UPDATEd in place and a revoked row is never deleted, or the
   * proof of what the user agreed to, and when, is gone — which is the failure mode
   * art. 4 exists to prevent.
   */
  async recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
    const { userId, type, version, granted, source, ipAddress, userAgent } = input;
    const now = this.#now();

    if (!granted) {
      // Read the active rows BEFORE revoking them, so the row to return is identified
      // by id rather than by matching on the timestamp just written. Postgres stores
      // `timestamp` at microsecond precision while JS Date carries milliseconds, so a
      // `revokedAt: now` equality lookup is not a safe way to find what was updated.
      const active = await this.#prisma.consentRecord.findMany({
        where: { userId, type, granted: true, revokedAt: null },
        orderBy: { grantedAt: 'desc' },
        select: { id: true },
      });

      // Withdrawal is itself a record: revoke the active rows for this type rather
      // than deleting them.
      if (active.length > 0) {
        await this.#prisma.consentRecord.updateMany({
          where: { id: { in: active.map((row) => row.id) } },
          data: { revokedAt: now },
        });
      }

      // Return the row the withdrawal landed on so the client can render "revoked at".
      // If there was nothing active, insert an explicit `granted: false` record: a
      // refusal the user expressed is evidence too, and silently returning nothing
      // would leave the client unable to distinguish "refused" from "never asked".
      const newest = active[0];
      if (newest) {
        return this.#prisma.consentRecord.findUniqueOrThrow({ where: { id: newest.id } });
      }

      return this.#prisma.consentRecord.create({
        data: {
          userId,
          type,
          version,
          granted: false,
          revokedAt: now,
          source: source ?? null,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
    }

    const active = await this.#prisma.consentRecord.findFirst({
      where: { userId, type, version, granted: true, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    if (active) return active;

    return this.#prisma.consentRecord.create({
      data: {
        userId,
        type,
        version,
        granted: true,
        grantedAt: now,
        source: source ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // KVKK art. 11 — access and portability
  // -------------------------------------------------------------------------

  /**
   * Everything this account holds, as one JSON document.
   *
   * KVKK art. 11 gives the subject the right to know what is processed about them and
   * to receive it; art. 20 of the GDPR equivalent adds portability, which is why this
   * returns structured JSON rather than a rendered report.
   *
   * THE CONSTRAINT THAT SHAPES EVERY SELECT BELOW: an export is the user's own data,
   * not a dump of everyone they ever interacted with. Other people appear only as the
   * minimum needed to make the user's own record intelligible — a `username` and a
   * display name, never an email, never an id, never a profile. Exporting a friend's
   * email in response to an art. 11 request would be a data breach performed on
   * request, and the friend never consented to it.
   *
   * Reports are exported from the reporter's side only. The reports filed AGAINST
   * this user are withheld: disclosing them would identify the reporters and make the
   * reporting mechanism unusable, which is a legitimate-interest exemption under
   * KVKK art. 28 and the reason no platform discloses them.
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.#prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        avatarUrl: true,
        bio: true,
        timezone: true,
        birthDate: true,
        cycleXp: true,
        lifetimeXp: true,
        level: true,
        prestige: true,
        classType: true,
        strengthXp: true,
        enduranceXp: true,
        intelligenceXp: true,
        wisdomXp: true,
        charismaXp: true,
        dexterityXp: true,
        streakFreezes: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!user) throw notFound('User not found');

    const [habits, sessions, xpLedger, dailyUsage, posts, consents, reportsFiled] =
      await Promise.all([
        this.#prisma.habit.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            category: true,
            stat: true,
            targetMinutes: true,
            frequency: true,
            colorHex: true,
            currentStreak: true,
            longestStreak: true,
            lastCompletedDate: true,
            isArchived: true,
            archivedAt: true,
            createdAt: true,
          },
        }),

        this.#prisma.session.findMany({
          where: { userId },
          orderBy: { startedAt: 'asc' },
          select: {
            id: true,
            habitId: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            status: true,
            interruptions: true,
            xpAwarded: true,
            statXp: true,
            multiplierData: true,
            verification: true,
            proofUrl: true,
            // Exported deliberately: an automated negative decision the subject cannot
            // see is what KVKK art. 11(g) and GDPR art. 22 are about.
            isFlagged: true,
            flagReason: true,
            flaggedAt: true,
            createdAt: true,
          },
        }),

        this.#prisma.xpLedger.findMany({
          where: { userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            amount: true,
            reason: true,
            sessionId: true,
            note: true,
            createdAt: true,
          },
        }),

        this.#prisma.dailyUsage.findMany({
          where: { userId },
          orderBy: [{ dateKey: 'asc' }, { category: 'asc' }],
          select: { dateKey: true, category: true, fullRateMinutes: true, overCapMinutes: true },
        }),

        this.#prisma.post.findMany({
          where: { authorId: userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            content: true,
            imageUrl: true,
            sessionId: true,
            parentId: true,
            digestDate: true,
            digestStats: true,
            likeCount: true,
            commentCount: true,
            hiddenAt: true,
            hiddenReason: true,
            deletedAt: true,
            createdAt: true,
          },
        }),

        this.listConsents(userId),

        this.#prisma.report.findMany({
          where: { reporterId: userId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            reason: true,
            details: true,
            status: true,
            reviewedAt: true,
            resolutionNote: true,
            createdAt: true,
            // The reported party is identified only by username — enough for the
            // reporter to recognise their own report, nothing more.
            reportedUser: { select: { username: true } },
            postId: true,
          },
        }),
      ]);

    // Friendships and blocks are relationships, so the counterparty is unavoidable —
    // but it is reduced to a public handle. `username` and `displayName` are what any
    // visitor of a profile already sees; email, id and birth date are not.
    const friendships = await this.#prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      orderBy: { createdAt: 'asc' },
      select: {
        status: true,
        requesterId: true,
        acceptedAt: true,
        createdAt: true,
        requester: { select: { username: true, displayName: true } },
        addressee: { select: { username: true, displayName: true } },
      },
    });

    const blocks = await this.listBlocks(userId);

    return {
      exportedAt: this.#now().toISOString(),
      format: 'habitwar.export.v1',
      /**
       * Named so the recipient knows what this document is answering; the audit
       * flagged that §13 promised a deletion endpoint the schema made impossible, and
       * the same gap applied to access.
       */
      legalBasis: 'KVKK m.11 (access and data portability)',
      profile: {
        ...user,
        // BigInt is not JSON-serialisable; the ledger is the authority anyway, so the
        // exported value is the human-readable decimal string.
        lifetimeXp: user.lifetimeXp.toString(),
      },
      habits,
      sessions,
      xpLedger,
      dailyUsage,
      posts,
      friendships: friendships.map((friendship) => {
        const isRequester = friendship.requesterId === userId;
        const other = isRequester ? friendship.addressee : friendship.requester;
        return {
          username: other.username,
          displayName: other.displayName,
          direction: isRequester ? 'SENT' : 'RECEIVED',
          status: friendship.status,
          acceptedAt: friendship.acceptedAt,
          createdAt: friendship.createdAt,
        };
      }),
      blocks,
      consents,
      reportsFiled: reportsFiled.map((report) => ({
        id: report.id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        reviewedAt: report.reviewedAt,
        resolutionNote: report.resolutionNote,
        createdAt: report.createdAt,
        targetType: report.postId ? 'POST' : 'USER',
        targetPostId: report.postId,
        targetUsername: report.reportedUser?.username ?? null,
      })),
      /**
       * Explicitly documented rather than silently omitted, so the export is honest
       * about its own boundaries — which an access response is required to be.
       */
      omitted: {
        reportsAgainstYou:
          'Withheld to protect the identity of reporters; disclosure would make the ' +
          'reporting mechanism unusable (KVKK m.28 legitimate interest).',
        otherUsersPersonalData:
          'Counterparties appear as public handles only. Their email addresses, ' +
          'identifiers and profile data are their personal data, not yours.',
      },
    };
  }

  // -------------------------------------------------------------------------
  // KVKK art. 7 — erasure
  // -------------------------------------------------------------------------

  /**
   * Honours an account deletion request.
   *
   * SOFT delete, by reusing `softDeleteUser` from modules/users/service.ts — the same
   * path the Clerk `user.deleted` webhook takes, so an account deleted from either
   * side ends in exactly one state.
   *
   * Why not a hard delete here: the user's sessions are the basis of OTHER users'
   * aggregates (duel results, league standings, peer verification) and of any dispute
   * the user may still raise over an XP correction. Destroying the rows in the same
   * request would silently rewrite third parties' history and remove the evidence the
   * user's own appeal would rest on. Erasure is therefore effective immediately from
   * the user's side — see below — while the row is purged by the scheduled job after
   * ACCOUNT_ERASURE_RETENTION_DAYS.
   *
   * The session dies with the request: `plugins/auth.ts` rejects any user row with
   * `deletedAt` set — the clerk path with a 403 'Account has been deleted', the dev
   * path by filtering `deletedAt: null` in its lookup and answering 401. Verified
   * against that file; no token revocation call is needed on this side.
   *
   * Idempotent: a repeat request returns the original deletion timestamp rather than
   * resetting the retention clock, which would otherwise let a retrying client keep
   * the row alive indefinitely.
   */
  async requestAccountDeletion(userId: string): Promise<AccountDeletionResult> {
    const user = await this.#prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (!user) throw notFound('User not found');

    // `softDeleteUser` already returns early for an already-deleted row, so the
    // existing timestamp survives a repeat request.
    const deleted = await softDeleteUser(this.#prisma, userId);
    const deletedAt = deleted?.deletedAt ?? user.deletedAt ?? this.#now();

    return {
      deletedAt,
      purgeEligibleAt: new Date(
        deletedAt.getTime() + ACCOUNT_ERASURE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
      retentionDays: ACCOUNT_ERASURE_RETENTION_DAYS,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Resolves a username to a live account.
   *
   * Soft-deleted users are invisible here on purpose: they cannot be blocked (there
   * is nothing left to block) and surfacing them would confirm that a handle once
   * existed.
   */
  async #findActiveUserByUsername(username: string): Promise<{ id: string }> {
    const user = await this.#prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw notFound('User not found');
    return user;
  }
}

/**
 * Normalised, direction-free friendship pair identity.
 *
 * Duplicated deliberately from the friendship service rather than imported: that
 * module is not written yet, and this file must not wait on it to enforce the block.
 * `schema.prisma` documents the rule as `[a, b].sort().join(':')`; when the
 * friendship service lands, this should be deleted in favour of its helper so there
 * is only one implementation.
 */
export function friendshipPairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}
