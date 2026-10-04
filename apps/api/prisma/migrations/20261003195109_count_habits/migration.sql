-- CreateEnum
CREATE TYPE "HabitKind" AS ENUM ('TIMED', 'COUNT');

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN     "kind" "HabitKind" NOT NULL DEFAULT 'TIMED',
ADD COLUMN     "targetCount" INTEGER,
ADD COLUMN     "unit" VARCHAR(20);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "count" INTEGER;
