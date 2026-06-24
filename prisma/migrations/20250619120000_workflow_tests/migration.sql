-- CreateTable
CREATE TABLE "WorkflowTest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "delayMs" INTEGER NOT NULL DEFAULT 0,
    "groups" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTestRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowTestId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "delayMs" INTEGER NOT NULL,
    "database" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTest_userId_updatedAt_idx" ON "WorkflowTest"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTest_userId_name_key" ON "WorkflowTest"("userId", "name");

-- CreateIndex
CREATE INDEX "WorkflowTestRun_userId_ranAt_idx" ON "WorkflowTestRun"("userId", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "WorkflowTestRun_workflowTestId_ranAt_idx" ON "WorkflowTestRun"("workflowTestId", "ranAt" DESC);

-- AddForeignKey
ALTER TABLE "WorkflowTest" ADD CONSTRAINT "WorkflowTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTestRun" ADD CONSTRAINT "WorkflowTestRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTestRun" ADD CONSTRAINT "WorkflowTestRun_workflowTestId_fkey" FOREIGN KEY ("workflowTestId") REFERENCES "WorkflowTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
