-- AlterTable: link a MoM action item to the task it became
ALTER TABLE "MeetingMinutesItem" ADD COLUMN "taskId" TEXT;
