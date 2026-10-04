-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CHALLENGE_DISPUTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpReason" ADD VALUE 'DUEL_REWARD';
ALTER TYPE "XpReason" ADD VALUE 'DUEL_REVERSAL';

-- AlterTable
ALTER TABLE "Challenge" ADD COLUMN     "task" TEXT;

-- CreateTable
CREATE TABLE "DuelCheckIn" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "note" TEXT,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DuelCheckIn_userId_createdAt_idx" ON "DuelCheckIn"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DuelCheckIn_challengeId_userId_dayIndex_key" ON "DuelCheckIn"("challengeId", "userId", "dayIndex");

-- AddForeignKey
ALTER TABLE "DuelCheckIn" ADD CONSTRAINT "DuelCheckIn_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelCheckIn" ADD CONSTRAINT "DuelCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
