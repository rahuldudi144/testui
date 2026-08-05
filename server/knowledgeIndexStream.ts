/**
 * Knowledge indexing SSE helpers — enrich progress with stored documents
 * via DatabaseAgent.listKnowledgeDocuments (testui only).
 */
import type { KnowledgeEvent } from "../../types/events.js";
import type { KnowledgeDocument } from "../../types/knowledge.js";
import type { DatabaseType } from "../../types/index.js";
import { createAgent } from "./agent.js";
import { indexConnectionKnowledge } from "./indexConnectionKnowledge.js";
import { prisma } from "./db.js";
import { getActiveAgentForUser, profileAgentConfig } from "./userAgent.js";
import { resolveKnowledgeDbUri, toPublicDatabase } from "./userDatabase.js";
import { errorMessage } from "../../utils/errors.js";
import { isAbortError } from "../../utils/abort.js";

type SseWriter = {
  writeSSE: (input: { event: string; data: string }) => Promise<void>;
};

export async function listConnectionKnowledgeDocuments(
  connectionId: string,
  userId: string,
  tables?: string[],
): Promise<KnowledgeDocument[]> {
  const connection = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) {
    throw new Error("Database connection not found.");
  }

  const knowledgeDbUri = resolveKnowledgeDbUri(connection);
  const activeAgent = await getActiveAgentForUser(userId);
  const agent = createAgent(
    connection.dbType as DatabaseType,
    connection.dbUri,
    profileAgentConfig(activeAgent),
  );

  return agent.listKnowledgeDocuments({
    knowledgeDbUri,
    userId,
    databaseId: connectionId,
    tables,
  });
}

async function emitIndexedDocument(
  stream: SseWriter,
  agent: ReturnType<typeof createAgent>,
  knowledgeDbUri: string,
  userId: string,
  databaseId: string,
  table: string,
): Promise<void> {
  const documents = await agent.listKnowledgeDocuments({
    knowledgeDbUri,
    userId,
    databaseId,
    tables: [table],
  });
  const document = documents[0];
  if (!document) return;

  await stream.writeSSE({
    event: "knowledge_document",
    data: JSON.stringify({
      type: "knowledge_document",
      table,
      document,
    }),
  });
}

async function emitAllIndexedDocuments(
  stream: SseWriter,
  agent: ReturnType<typeof createAgent>,
  knowledgeDbUri: string,
  userId: string,
  databaseId: string,
): Promise<void> {
  const documents = await agent.listKnowledgeDocuments({
    knowledgeDbUri,
    userId,
    databaseId,
  });

  await stream.writeSSE({
    event: "knowledge_documents",
    data: JSON.stringify({
      type: "knowledge_documents",
      documents,
    }),
  });
}

/**
 * Run knowledge indexing and stream progress + per-table / full document previews.
 */
export async function streamKnowledgeIndexWithPreview(
  stream: SseWriter,
  connectionId: string,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const existing = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!existing) {
    throw new Error("Database connection not found.");
  }

  const knowledgeDbUri = resolveKnowledgeDbUri(existing);
  const activeAgent = await getActiveAgentForUser(userId);
  const agentOptions = profileAgentConfig(activeAgent);
  const agent = createAgent(
    existing.dbType as DatabaseType,
    existing.dbUri,
    agentOptions,
  );

  await stream.writeSSE({
    event: "status",
    data: JSON.stringify({ message: "indexing" }),
  });

  await indexConnectionKnowledge(connectionId, userId, {
    abortSignal: signal,
    agentOptions,
    onEvent: async (event: KnowledgeEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });

      if (event.type === "knowledge_progress") {
        await emitIndexedDocument(
          stream,
          agent,
          knowledgeDbUri,
          userId,
          connectionId,
          event.table,
        );
      } else if (event.type === "knowledge_completed") {
        await emitAllIndexedDocuments(
          stream,
          agent,
          knowledgeDbUri,
          userId,
          connectionId,
        );
      }
    },
  });

  if (signal.aborted) return;

  const connection = await prisma.databaseConnection.findUnique({
    where: { id: connectionId },
  });
  await stream.writeSSE({
    event: "done",
    data: JSON.stringify({
      database: toPublicDatabase(connection ?? existing),
    }),
  });
}

export async function streamKnowledgeIndexWithPreviewSafe(
  stream: SseWriter,
  connectionId: string,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const existing = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!existing) {
    throw new Error("Database connection not found.");
  }

  try {
    await streamKnowledgeIndexWithPreview(
      stream,
      connectionId,
      userId,
      signal,
    );
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return;
    const updated = await prisma.databaseConnection.findUnique({
      where: { id: connectionId },
    });
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: errorMessage(error),
        database: toPublicDatabase(updated ?? existing),
      }),
    });
  }
}
