-- AlterTable
ALTER TABLE "User" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- Accounts that predate the first-run flow have been playing already: they count as
-- onboarded from the day they joined, so the app does not send them through it.
UPDATE "User" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
