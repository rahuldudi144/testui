-- AlterTable
ALTER TABLE "DatabaseConnection" ADD COLUMN "businessContext" TEXT,
ADD COLUMN "dbMetadata" JSONB,
ADD COLUMN "schemaSyncedAt" TIMESTAMP(3),
ADD COLUMN "schemaSyncStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN "schemaSyncError" TEXT;
