-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "specCheckedAt" TIMESTAMP(3),
ADD COLUMN     "specDescHash" TEXT,
ADD COLUMN     "specMissing" TEXT,
ADD COLUMN     "specQuestions" TEXT,
ADD COLUMN     "specReady" BOOLEAN,
ADD COLUMN     "specScore" INTEGER;
