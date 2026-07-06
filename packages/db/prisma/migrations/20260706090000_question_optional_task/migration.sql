-- AlterTable: questions may attach to a session only (off-task work has no task)
ALTER TABLE "Question" ALTER COLUMN "taskId" DROP NOT NULL;
