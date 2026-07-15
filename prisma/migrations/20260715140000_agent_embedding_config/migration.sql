-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN IF NOT EXISTS "embeddingProvider" TEXT;
ALTER TABLE "AgentProfile" ADD COLUMN IF NOT EXISTS "embeddingModelName" TEXT;
ALTER TABLE "AgentProfile" ADD COLUMN IF NOT EXISTS "embeddingApiKey" TEXT;
ALTER TABLE "AgentProfile" ADD COLUMN IF NOT EXISTS "embeddingBaseUrl" TEXT;
