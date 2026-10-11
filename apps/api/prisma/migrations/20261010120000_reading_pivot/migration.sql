-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('TR', 'EN');

-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('READING', 'FINISHED');

-- Reading pivot (docs/product-v2.md). The old ledger rows record awards for timed
-- sessions, a model that no longer exists, and their reasons have no counterpart in
-- the new enum; the cast below would fail on them. XP restarts with the new economy.
DELETE FROM "XpLedger";

-- AlterEnum
BEGIN;
CREATE TYPE "XpReason_new" AS ENUM ('READING_LOG', 'MANUAL_ADJUSTMENT');
ALTER TABLE "XpLedger" ALTER COLUMN "reason" TYPE "XpReason_new" USING ("reason"::text::"XpReason_new");
ALTER TYPE "XpReason" RENAME TO "XpReason_old";
ALTER TYPE "XpReason_new" RENAME TO "XpReason";
DROP TYPE "XpReason_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Habit" DROP CONSTRAINT "Habit_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_habitId_fkey";

-- DropForeignKey
ALTER TABLE "XpLedger" DROP CONSTRAINT "XpLedger_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "DailyUsage" DROP CONSTRAINT "DailyUsage_userId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_requesterId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_addresseeId_fkey";

-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followerId_fkey";

-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followingId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_userAchievementId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_challengeId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_parentId_fkey";

-- DropForeignKey
ALTER TABLE "PostLike" DROP CONSTRAINT "PostLike_postId_fkey";

-- DropForeignKey
ALTER TABLE "PostLike" DROP CONSTRAINT "PostLike_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_actorId_fkey";

-- DropForeignKey
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_challengerId_fkey";

-- DropForeignKey
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_opponentId_fkey";

-- DropForeignKey
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_winnerId_fkey";

-- DropForeignKey
ALTER TABLE "DuelCheckIn" DROP CONSTRAINT "DuelCheckIn_challengeId_fkey";

-- DropForeignKey
ALTER TABLE "DuelCheckIn" DROP CONSTRAINT "DuelCheckIn_userId_fkey";

-- DropForeignKey
ALTER TABLE "Achievement" DROP CONSTRAINT "Achievement_seasonId_fkey";

-- DropForeignKey
ALTER TABLE "UserAchievement" DROP CONSTRAINT "UserAchievement_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserAchievement" DROP CONSTRAINT "UserAchievement_achievementId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reportedUserId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_postId_fkey";

-- DropForeignKey
ALTER TABLE "Block" DROP CONSTRAINT "Block_blockerId_fkey";

-- DropForeignKey
ALTER TABLE "Block" DROP CONSTRAINT "Block_blockedId_fkey";

-- DropForeignKey
ALTER TABLE "ConsentRecord" DROP CONSTRAINT "ConsentRecord_userId_fkey";

-- DropForeignKey
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_actorId_fkey";

-- DropForeignKey
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_subjectUserId_fkey";

-- DropForeignKey
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_subjectPostId_fkey";

-- DropForeignKey
ALTER TABLE "ModerationAction" DROP CONSTRAINT "ModerationAction_reportId_fkey";

-- DropIndex
DROP INDEX "User_lifetimeXp_idx";

-- DropIndex
DROP INDEX "XpLedger_sessionId_idx";

-- DropIndex
DROP INDEX "PushToken_userId_deviceId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "bio",
DROP COLUMN "birthDate",
DROP COLUMN "charismaXp",
DROP COLUMN "classType",
DROP COLUMN "cycleXp",
DROP COLUMN "dexterityXp",
DROP COLUMN "enduranceXp",
DROP COLUMN "intelligenceXp",
DROP COLUMN "lifetimeXp",
DROP COLUMN "prestige",
DROP COLUMN "role",
DROP COLUMN "storyStartedAt",
DROP COLUMN "streakFreezes",
DROP COLUMN "strengthXp",
DROP COLUMN "suspendedUntil",
DROP COLUMN "suspensionReason",
DROP COLUMN "wisdomXp",
ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyGoal" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "goalSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastReadDate" VARCHAR(10),
ADD COLUMN     "lastRemindedDate" VARCHAR(10),
ADD COLUMN     "locale" "Locale" NOT NULL DEFAULT 'TR',
ADD COLUMN     "longestStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderTime" VARCHAR(5),
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "XpLedger" DROP COLUMN "sessionId",
ADD COLUMN     "readingLogId" TEXT;

-- AlterTable
ALTER TABLE "PushToken" DROP COLUMN "deviceId",
DROP COLUMN "lastUsedAt";

-- DropTable
DROP TABLE "Habit";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "DailyUsage";

-- DropTable
DROP TABLE "Friendship";

-- DropTable
DROP TABLE "Follow";

-- DropTable
DROP TABLE "Post";

-- DropTable
DROP TABLE "PostLike";

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "Challenge";

-- DropTable
DROP TABLE "DuelCheckIn";

-- DropTable
DROP TABLE "Achievement";

-- DropTable
DROP TABLE "UserAchievement";

-- DropTable
DROP TABLE "Season";

-- DropTable
DROP TABLE "Report";

-- DropTable
DROP TABLE "Block";

-- DropTable
DROP TABLE "ConsentRecord";

-- DropTable
DROP TABLE "ModerationAction";

-- DropEnum
DROP TYPE "Category";

-- DropEnum
DROP TYPE "Stat";

-- DropEnum
DROP TYPE "ClassType";

-- DropEnum
DROP TYPE "SessionStatus";

-- DropEnum
DROP TYPE "Verification";

-- DropEnum
DROP TYPE "HabitKind";

-- DropEnum
DROP TYPE "Frequency";

-- DropEnum
DROP TYPE "FriendshipStatus";

-- DropEnum
DROP TYPE "PostType";

-- DropEnum
DROP TYPE "NotificationType";

-- DropEnum
DROP TYPE "NotificationTargetType";

-- DropEnum
DROP TYPE "ChallengeStatus";

-- DropEnum
DROP TYPE "AchievementCategory";

-- DropEnum
DROP TYPE "AchievementTier";

-- DropEnum
DROP TYPE "ReportReason";

-- DropEnum
DROP TYPE "ReportStatus";

-- DropEnum
DROP TYPE "ConsentType";

-- DropEnum
DROP TYPE "UserRole";

-- DropEnum
DROP TYPE "ModerationActionType";

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "author" VARCHAR(200),
    "pageCount" INTEGER NOT NULL,
    "pagesRead" INTEGER NOT NULL DEFAULT 0,
    "status" "BookStatus" NOT NULL DEFAULT 'READING',
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadingLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,
    "dateKey" VARCHAR(10) NOT NULL,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "score" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Book_userId_status_idx" ON "Book"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingLog_clientRequestId_key" ON "ReadingLog"("clientRequestId");

-- CreateIndex
CREATE INDEX "ReadingLog_userId_dateKey_idx" ON "ReadingLog"("userId", "dateKey");

-- CreateIndex
CREATE INDEX "ReadingLog_bookId_createdAt_idx" ON "ReadingLog"("bookId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "User_reminderTime_idx" ON "User"("reminderTime");

-- CreateIndex
CREATE INDEX "XpLedger_readingLogId_idx" ON "XpLedger"("readingLogId");

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLog" ADD CONSTRAINT "ReadingLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLog" ADD CONSTRAINT "ReadingLog_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_readingLogId_fkey" FOREIGN KEY ("readingLogId") REFERENCES "ReadingLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

