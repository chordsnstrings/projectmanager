-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "attendees" TEXT NOT NULL,
    "agenda" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMinutesItem" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "timeline" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,

    CONSTRAINT "MeetingMinutesItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutes_sessionId_key" ON "MeetingMinutes"("sessionId");

-- CreateIndex
CREATE INDEX "MeetingMinutes_sessionId_idx" ON "MeetingMinutes"("sessionId");

-- CreateIndex
CREATE INDEX "MeetingMinutesItem_minutesId_idx" ON "MeetingMinutesItem"("minutesId");

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutesItem" ADD CONSTRAINT "MeetingMinutesItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
