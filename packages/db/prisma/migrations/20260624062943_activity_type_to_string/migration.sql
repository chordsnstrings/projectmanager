-- Convert ActivitySegment.type from the ActivityType enum to TEXT (lossless).
-- Per-team activity keys live in the @cadence/shared registry, not a DB enum.
ALTER TABLE "ActivitySegment" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

-- The enum is no longer referenced by any column.
DROP TYPE "ActivityType";
