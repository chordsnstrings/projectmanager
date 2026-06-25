-- CreateTable
CREATE TABLE "DailyCheckin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "productivity" INTEGER,
    "blocker" TEXT,
    "blockerNote" TEXT,
    "focus" TEXT,
    "focusTaskIds" TEXT,
    "confidence" INTEGER,
    "carryover" TEXT,
    "yesterdayActiveMinutes" INTEGER,
    "yesterdayCompleted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCheckin_userId_localDate_idx" ON "DailyCheckin"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckin_userId_localDate_key" ON "DailyCheckin"("userId", "localDate");

-- AddForeignKey
ALTER TABLE "DailyCheckin" ADD CONSTRAINT "DailyCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
