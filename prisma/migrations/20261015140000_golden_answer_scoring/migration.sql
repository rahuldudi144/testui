-- Golden-answer sets and run scoring metadata for the Test UI.

CREATE TABLE "GoldenSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "fingerprint" JSONB,
    "itemCount" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldenSet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GoldenSet_userId_createdAt_idx" ON "GoldenSet"("userId", "createdAt" DESC);

ALTER TABLE "GoldenSet" ADD CONSTRAINT "GoldenSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkflowTest" ADD COLUMN "goldenSetId" TEXT;

ALTER TABLE "WorkflowTest" ADD CONSTRAINT "WorkflowTest_goldenSetId_fkey" FOREIGN KEY ("goldenSetId") REFERENCES "GoldenSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowTestRun" ADD COLUMN "fingerprintStatus" TEXT;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "repeats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "infraErrorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "goldenFileHash" TEXT;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "suiteFileHash" TEXT;
ALTER TABLE "WorkflowTestRun" ADD COLUMN "stopReason" TEXT;
