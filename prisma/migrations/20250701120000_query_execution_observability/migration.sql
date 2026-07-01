-- CreateEnum
CREATE TYPE "QueryExecutionSource" AS ENUM ('workflow_test', 'chat');

-- AlterTable
ALTER TABLE "WorkflowTestRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "QueryExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "QueryExecutionSource" NOT NULL,
    "workflowTestRunId" TEXT,
    "messageId" TEXT,
    "queryKey" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "query" TEXT NOT NULL,
    "groupName" TEXT,
    "status" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "llmCallCount" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" JSONB,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueryExecution_messageId_key" ON "QueryExecution"("messageId");

-- CreateIndex
CREATE INDEX "QueryExecution_userId_ranAt_idx" ON "QueryExecution"("userId", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "QueryExecution_workflowTestRunId_idx" ON "QueryExecution"("workflowTestRunId");

-- CreateIndex
CREATE INDEX "QueryExecution_messageId_idx" ON "QueryExecution"("messageId");

-- AddForeignKey
ALTER TABLE "QueryExecution" ADD CONSTRAINT "QueryExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryExecution" ADD CONSTRAINT "QueryExecution_workflowTestRunId_fkey" FOREIGN KEY ("workflowTestRunId") REFERENCES "WorkflowTestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryExecution" ADD CONSTRAINT "QueryExecution_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
