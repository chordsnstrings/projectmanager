-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'dev');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('issue', 'pr', 'branch');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'in_review', 'done');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('coding', 'debugging', 'research', 'agent', 'review');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('inferred', 'manual');

-- CreateEnum
CREATE TYPE "GitEventType" AS ENUM ('commit', 'pr_opened', 'pr_merged', 'pr_closed', 'pr_review', 'push');

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('open_no_activity', 'activity_no_session', 'long_open_session', 'overrun');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('open', 'answered');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'dev',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "githubRepoId" BIGINT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "installationId" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "source" "TaskSource" NOT NULL,
    "githubNumber" INTEGER,
    "branch" TEXT,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "assigneeUserId" TEXT,
    "estimateMinutes" INTEGER,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "offTaskLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "intent" TEXT,
    "summary" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySegment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "source" "ActivitySource" NOT NULL DEFAULT 'inferred',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitEvent" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "taskId" TEXT,
    "authorUserId" TEXT,
    "type" "GitEventType" NOT NULL,
    "sha" TEXT,
    "prNumber" INTEGER,
    "branch" TEXT,
    "additions" INTEGER,
    "deletions" INTEGER,
    "filesChanged" INTEGER,
    "message" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deliveryId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "type" "FlagType" NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "taskId" TEXT,
    "gitEventId" TEXT,
    "detail" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sessionId" TEXT,
    "body" TEXT NOT NULL,
    "blocksNext" BOOLEAN NOT NULL DEFAULT true,
    "status" "QuestionStatus" NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubLogin_key" ON "User"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "UserEmail_email_key" ON "UserEmail"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubInstallationId_key" ON "Installation"("githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_githubRepoId_key" ON "Repo"("githubRepoId");

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_status_idx" ON "Task"("assigneeUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_repoId_source_githubNumber_branch_key" ON "Task"("repoId", "source", "githubNumber", "branch");

-- CreateIndex
CREATE INDEX "Session_userId_startedAt_idx" ON "Session"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GitEvent_deliveryId_key" ON "GitEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "GitEvent_repoId_occurredAt_idx" ON "GitEvent"("repoId", "occurredAt");

-- CreateIndex
CREATE INDEX "GitEvent_taskId_idx" ON "GitEvent"("taskId");

-- CreateIndex
CREATE INDEX "Flag_userId_status_idx" ON "Flag"("userId", "status");

-- CreateIndex
CREATE INDEX "Question_targetUserId_status_idx" ON "Question"("targetUserId", "status");

-- AddForeignKey
ALTER TABLE "UserEmail" ADD CONSTRAINT "UserEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySegment" ADD CONSTRAINT "ActivitySegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitEvent" ADD CONSTRAINT "GitEvent_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitEvent" ADD CONSTRAINT "GitEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
