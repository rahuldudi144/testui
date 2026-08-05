-- AlterTable
ALTER TABLE "WorkflowTest" ADD COLUMN IF NOT EXISTS "databaseConnectionId" TEXT;

-- AlterTable
ALTER TABLE "WorkflowTestGroup" ADD COLUMN IF NOT EXISTS "categoryType" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "WorkflowTestGroup" ADD COLUMN IF NOT EXISTS "executionOverrides" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkflowTest_databaseConnectionId_idx" ON "WorkflowTest"("databaseConnectionId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowTest_databaseConnectionId_fkey'
  ) THEN
    ALTER TABLE "WorkflowTest"
      ADD CONSTRAINT "WorkflowTest_databaseConnectionId_fkey"
      FOREIGN KEY ("databaseConnectionId") REFERENCES "DatabaseConnection"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
