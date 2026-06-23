-- AlterEnum
ALTER TYPE "GitEventType" ADD VALUE 'release';

-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "latestVersion" TEXT,
ADD COLUMN     "latestVersionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "milestoneDueOn" TIMESTAMP(3),
ADD COLUMN     "milestoneTitle" TEXT;
