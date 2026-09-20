-- Moderator tooling: roles, suspension, content hiding and an audit trail.
--
-- The isHidden -> hiddenAt collapse is written by hand rather than taken from the
-- generated diff, because the generated version drops the column outright. Two
-- columns described one fact and the code disagreed about which to use: the
-- moderation service wrote hiddenAt, the feed read isHidden, so hiding a post did
-- nothing. Any row that was genuinely hidden must survive that reconciliation, so
-- the data moves before the column goes.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('REPORT_DISMISSED', 'POST_HIDDEN', 'POST_RESTORED', 'USER_SUSPENDED', 'USER_REINSTATED', 'USER_WARNED');

-- DropIndex
DROP INDEX "Post_isHidden_createdAt_idx";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "hiddenReason" VARCHAR(500);

-- Preserve every genuinely hidden post: give it a timestamp before the flag goes.
UPDATE "Post" SET "hiddenAt" = COALESCE("hiddenAt", CURRENT_TIMESTAMP) WHERE "isHidden" = true;

ALTER TABLE "Post" DROP COLUMN "isHidden";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "suspendedUntil" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" VARCHAR(500);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "ModerationActionType" NOT NULL,
    "subjectUserId" TEXT,
    "subjectPostId" TEXT,
    "reportId" TEXT,
    "reason" VARCHAR(1000) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationAction_subjectUserId_createdAt_idx" ON "ModerationAction"("subjectUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_actorId_createdAt_idx" ON "ModerationAction"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");

-- CreateIndex
CREATE INDEX "Post_hiddenAt_createdAt_idx" ON "Post"("hiddenAt", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_subjectPostId_fkey" FOREIGN KEY ("subjectPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

