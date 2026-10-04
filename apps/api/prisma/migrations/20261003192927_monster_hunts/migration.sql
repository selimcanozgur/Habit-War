-- CreateEnum
CREATE TYPE "HuntStatus" AS ENUM ('ACTIVE', 'DEFEATED', 'FLED');

-- DropForeignKey
ALTER TABLE "BossEncounter" DROP CONSTRAINT "BossEncounter_userId_fkey";

-- DropTable
DROP TABLE "BossEncounter";

-- CreateTable
CREATE TABLE "MonsterHunt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monsterKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "status" "HuntStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonsterHunt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonsterHunt_userId_status_endedAt_idx" ON "MonsterHunt"("userId", "status", "endedAt" DESC);

-- AddForeignKey
ALTER TABLE "MonsterHunt" ADD CONSTRAINT "MonsterHunt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

