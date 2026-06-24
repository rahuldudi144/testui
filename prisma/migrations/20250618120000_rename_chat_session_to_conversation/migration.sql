-- Rename ChatSession to Conversation
ALTER TABLE "ChatSession" RENAME TO "Conversation";

-- Rename primary key constraint
ALTER TABLE "Conversation" RENAME CONSTRAINT "ChatSession_pkey" TO "Conversation_pkey";

-- Rename userId index
ALTER INDEX "ChatSession_userId_idx" RENAME TO "Conversation_userId_idx";

-- Rename foreign key on Conversation
ALTER TABLE "Conversation" RENAME CONSTRAINT "ChatSession_userId_fkey" TO "Conversation_userId_fkey";

-- Rename sessionId to conversationId on Message
ALTER TABLE "Message" RENAME COLUMN "sessionId" TO "conversationId";

-- Rename message index and foreign key
ALTER INDEX "Message_sessionId_idx" RENAME TO "Message_conversationId_idx";
ALTER TABLE "Message" RENAME CONSTRAINT "Message_sessionId_fkey" TO "Message_conversationId_fkey";
