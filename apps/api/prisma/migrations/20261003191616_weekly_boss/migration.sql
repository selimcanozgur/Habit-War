-- CreateTable
CREATE TABLE "BossEncounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "bossKey" TEXT NOT NULL,
    "maxHp" INTEGER NOT NULL,
    "defeatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BossEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BossEncounter_userId_defeatedAt_idx" ON "BossEncounter"("userId", "defeatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BossEncounter_userId_weekStart_key" ON "BossEncounter"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "BossEncounter" ADD CONSTRAINT "BossEncounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
