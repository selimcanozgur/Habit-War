-- DropForeignKey
ALTER TABLE "MonsterHunt" DROP CONSTRAINT "MonsterHunt_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "storyStartedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "MonsterHunt";

-- DropEnum
DROP TYPE "HuntStatus";

