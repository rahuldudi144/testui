-- Rename legacy NORMAL category to STANDARD (default execution mode).
UPDATE "WorkflowTestGroup"
SET "categoryType" = 'STANDARD'
WHERE "categoryType" = 'NORMAL';

ALTER TABLE "WorkflowTestGroup"
  ALTER COLUMN "categoryType" SET DEFAULT 'STANDARD';
