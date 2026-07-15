/**
 * Knowledge indexing for testui connections (v3).
 * Replaces parseSchema-based schema sync.
 */
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { createAdapter } from "../../database/createAdapter.js";
import type { DatabaseType } from "../../types/index.js";
import type { KnowledgeEvent } from "../../types/events.js";
import { errorMessage } from "../../utils/errors.js";
import { prisma } from "./db.js";
import { createAgent } from "./agent.js";
import type { AgentConfigOverrides } from "./agent.js";
import { getActiveAgentForUser, profileAgentConfig } from "./userAgent.js";
import { countTables, resolveKnowledgeDbUri } from "./userDatabase.js";

export type KnowledgeIndexStatus = "idle" | "syncing" | "ready" | "failed";

export { countTables };

export function hashSchema(schema: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(schema))
    .digest("hex");
}

export async function fetchConnectionSchema(
  dbType: DatabaseType,
  dbUri: string,
): Promise<{ dbMetadata: unknown; schemaTableCount: number }> {
  const adapter = createAdapter(dbType, dbUri);

  try {
    await adapter.connect();
    const liveSchema = await adapter.fetchSchema();
    await adapter.close();

    return {
      dbMetadata: liveSchema,
      schemaTableCount: countTables(liveSchema),
    };
  } catch (err) {
    try {
      await adapter.close();
    } catch {
      // ignore close errors
    }
    throw err;
  }
}

export type IndexKnowledgeOptions = {
  abortSignal?: AbortSignal;
  onEvent?: (event: KnowledgeEvent) => void | Promise<void>;
  agentOptions?: AgentConfigOverrides;
};

/**
 * Fetch live schema and stream-index into the knowledge (pgvector) database.
 */
export async function indexConnectionKnowledge(
  connectionId: string,
  userId: string,
  options: IndexKnowledgeOptions = {},
): Promise<void> {
  const connection = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) {
    throw new Error("Database connection not found.");
  }

  const knowledgeDbUri = resolveKnowledgeDbUri(connection);

  await prisma.databaseConnection.update({
    where: { id: connectionId },
    data: {
      schemaSyncStatus: "syncing",
      schemaSyncError: null,
    },
  });

  const dbType = connection.dbType as DatabaseType;
  const activeAgent = await getActiveAgentForUser(userId);
  const agentOptions =
    options.agentOptions ?? profileAgentConfig(activeAgent);

  try {
    const { dbMetadata } = await fetchConnectionSchema(dbType, connection.dbUri);
    const schemaHash = hashSchema(dbMetadata);

    await prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        dbMetadata: dbMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    const agent = createAgent(dbType, connection.dbUri, agentOptions);
    const businessSummary = connection.businessContext?.trim() || undefined;

    for await (const event of agent.streamKnowledgeBase({
      knowledgeDbUri,
      userId,
      databaseId: connectionId,
      businessSummary,
      schemaHash,
      abortSignal: options.abortSignal,
    })) {
      await options.onEvent?.(event);
      if (event.type === "knowledge_failed") {
        throw new Error(
          `Knowledge indexing failed for table "${event.table}": ${event.error}`,
        );
      }
    }

    await prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        schemaSyncedAt: new Date(),
        schemaSyncStatus: "ready",
        schemaSyncError: null,
      },
    });
  } catch (err) {
    const message = errorMessage(err);
    await prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        schemaSyncStatus: "failed",
        schemaSyncError: message,
      },
    });
    throw err;
  }
}

/** @deprecated Use indexConnectionKnowledge — kept as alias for callers mid-migration. */
export async function syncConnectionSchema(
  connectionId: string,
  userId: string,
): Promise<void> {
  await indexConnectionKnowledge(connectionId, userId);
}

/** @deprecated Use fetchConnectionSchema */
export async function fetchAndParseConnectionSchema(
  dbType: DatabaseType,
  dbUri: string,
  _agentOptions?: AgentConfigOverrides,
): Promise<{ dbMetadata: unknown; schemaTableCount: number }> {
  return fetchConnectionSchema(dbType, dbUri);
}
