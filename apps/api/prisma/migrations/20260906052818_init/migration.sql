-- CreateEnum
CREATE TYPE "Category" AS ENUM ('FITNESS', 'STUDY', 'MINDFULNESS', 'CREATIVE', 'SOCIAL', 'HEALTH', 'SKILL');

-- CreateEnum
CREATE TYPE "Stat" AS ENUM ('STR', 'END', 'INT', 'WIS', 'CHA', 'DEX');

-- CreateEnum
CREATE TYPE "ClassType" AS ENUM ('SCHOLAR', 'BERSERKER', 'BARD', 'MONK', 'RANGER', 'ARTISAN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "Verification" AS ENUM ('MANUAL_ENTRY', 'TIMER_ONLY', 'HEALTH_DATA', 'PHOTO_PROOF', 'PEER_VERIFIED');

-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('SESSION_AWARD', 'SESSION_REVERSAL', 'ANOMALY_CORRECTION', 'MANUAL_ADJUSTMENT', 'PRESTIGE_RESET');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" VARCHAR(160),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "birthDate" DATE,
    "cycleXp" INTEGER NOT NULL DEFAULT 0,
    "lifetimeXp" BIGINT NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "prestige" INTEGER NOT NULL DEFAULT 0,
    "classType" "ClassType",
    "strengthXp" INTEGER NOT NULL DEFAULT 0,
    "enduranceXp" INTEGER NOT NULL DEFAULT 0,
    "intelligenceXp" INTEGER NOT NULL DEFAULT 0,
    "wisdomXp" INTEGER NOT NULL DEFAULT 0,
    "charismaXp" INTEGER NOT NULL DEFAULT 0,
    "dexterityXp" INTEGER NOT NULL DEFAULT 0,
    "streakFreezes" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Habit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" "Category" NOT NULL,
    "stat" "Stat",
    "targetMinutes" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'DAILY',
    "colorHex" VARCHAR(7) NOT NULL DEFAULT '#6366F1',
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCompletedDate" VARCHAR(10),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Habit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "interruptions" INTEGER NOT NULL DEFAULT 0,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "statXp" INTEGER NOT NULL DEFAULT 0,
    "multiplierData" JSONB,
    "verification" "Verification" NOT NULL DEFAULT 'TIMER_ONLY',
    "proofUrl" TEXT,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "XpReason" NOT NULL,
    "sessionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" VARCHAR(10) NOT NULL,
    "category" "Category" NOT NULL,
    "fullRateMinutes" INTEGER NOT NULL DEFAULT 0,
    "overCapMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_lifetimeXp_idx" ON "User"("lifetimeXp" DESC);

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE INDEX "Habit_userId_isArchived_idx" ON "Habit"("userId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Session_clientRequestId_key" ON "Session"("clientRequestId");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Session_habitId_startedAt_idx" ON "Session"("habitId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Session_status_startedAt_idx" ON "Session"("status", "startedAt");

-- CreateIndex
CREATE INDEX "XpLedger_userId_createdAt_idx" ON "XpLedger"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "XpLedger_sessionId_idx" ON "XpLedger"("sessionId");

-- CreateIndex
CREATE INDEX "DailyUsage_userId_dateKey_idx" ON "DailyUsage"("userId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_userId_dateKey_category_key" ON "DailyUsage"("userId", "dateKey", "category");

-- AddForeignKey
ALTER TABLE "Habit" ADD CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpLedger" ADD CONSTRAINT "XpLedger_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
