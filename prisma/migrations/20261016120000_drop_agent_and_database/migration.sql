-- Drop saved agent profiles and database connections.
-- Chat and workflow runs use DB_AGENT_* from the environment.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeDatabaseId_fkey";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_activeAgentId_fkey";
ALTER TABLE "WorkflowTest" DROP CONSTRAINT IF EXISTS "WorkflowTest_agentProfileId_fkey";
ALTER TABLE "WorkflowTest" DROP CONSTRAINT IF EXISTS "WorkflowTest_databaseConnectionId_fkey";
ALTER TABLE "WorkflowTestRun" DROP CONSTRAINT IF EXISTS "WorkflowTestRun_agentProfileId_fkey";

DROP INDEX IF EXISTS "WorkflowTest_userId_name_agentProfileId_key";
DROP INDEX IF EXISTS "WorkflowTest_databaseConnectionId_idx";

ALTER TABLE "User" DROP COLUMN IF EXISTS "activeDatabaseId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "activeAgentId";
ALTER TABLE "WorkflowTest" DROP COLUMN IF EXISTS "agentProfileId";
ALTER TABLE "WorkflowTest" DROP COLUMN IF EXISTS "databaseConnectionId";
ALTER TABLE "WorkflowTestRun" DROP COLUMN IF EXISTS "agentProfileId";

CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTest_userId_name_key" ON "WorkflowTest"("userId", "name");

DROP TABLE IF EXISTS "AgentProfile";
DROP TABLE IF EXISTS "DatabaseConnection";
