-- DropIndex
DROP INDEX "WorkflowTest_userId_name_key";

-- AlterTable
ALTER TABLE "WorkflowTest" ADD COLUMN "agentProfileId" TEXT;
ALTER TABLE "WorkflowTest" ADD COLUMN "suiteKey" TEXT;

-- AlterTable
ALTER TABLE "WorkflowTestRun" ADD COLUMN "agentProfileId" TEXT;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "agent" JSONB;

-- Backfill suiteKey for existing tests
UPDATE "WorkflowTest" SET "suiteKey" = "id" WHERE "suiteKey" IS NULL;

-- CreateIndex
CREATE INDEX "WorkflowTest_userId_suiteKey_idx" ON "WorkflowTest"("userId", "suiteKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTest_userId_name_agentProfileId_key" ON "WorkflowTest"("userId", "name", "agentProfileId");

-- AddForeignKey
ALTER TABLE "WorkflowTest" ADD CONSTRAINT "WorkflowTest_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTestRun" ADD CONSTRAINT "WorkflowTestRun_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
