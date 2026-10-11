-- AlterTable
ALTER TABLE "User" ADD COLUMN     "yearlyBookGoal" INTEGER;

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "coverUrl" VARCHAR(500),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "review" VARCHAR(280),
ADD COLUMN     "takeaways" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ReadingLog" ADD COLUMN     "note" VARCHAR(280);

