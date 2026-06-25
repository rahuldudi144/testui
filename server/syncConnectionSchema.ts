import type { Prisma } from "@prisma/client";
import { createAdapter } from "../../database/createAdapter.js";
import type { DatabaseType } from "../../types/index.js";
import { errorMessage } from "../../utils/errors.js";
import { prisma } from "./db.js";
import { createAgent } from "./agent.js";
import type { AgentConfigOverrides } from "./agent.js";
import { getActiveAgentForUser, profileAgentConfig } from "./userAgent.js";

export type SchemaSyncStatus = "idle" | "syncing" | "ready" | "failed";

function countTables(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }
  const record = metadata as Record<string, unknown>;
  const tables = record.tables;
  if (tables && typeof tables === "object" && !Array.isArray(tables)) {
    return Object.keys(tables).length;
  }
  return 0;
}

export async function syncConnectionSchema(
  connectionId: string,
  userId: string,
): Promise<void> {
  const connection = await prisma.databaseConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) {
    throw new Error("Database connection not found.");
  }

  await prisma.databaseConnection.update({
    where: { id: connectionId },
    data: {
      schemaSyncStatus: "syncing",
      schemaSyncError: null,
    },
  });

  const dbType = connection.dbType as DatabaseType;
  const activeAgent = await getActiveAgentForUser(userId);
  const agentOptions = profileAgentConfig(activeAgent);

  try {
    const { dbMetadata } = await fetchAndParseConnectionSchema(
      dbType,
      connection.dbUri,
      agentOptions,
    );

    await prisma.databaseConnection.update({
      where: { id: connectionId },
      data: {
        dbMetadata: dbMetadata as unknown as Prisma.InputJsonValue,
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

export async function fetchAndParseConnectionSchema(
  dbType: DatabaseType,
  dbUri: string,
  agentOptions?: AgentConfigOverrides,
): Promise<{ dbMetadata: unknown; schemaTableCount: number }> {
  const adapter = createAdapter(dbType, dbUri);

  try {
    await adapter.connect();
    const liveSchema = await adapter.fetchSchema();
    await adapter.close();

    const agent = createAgent(dbType, dbUri, agentOptions);
    const annotated = await agent.parseSchema(liveSchema);

    return {
      dbMetadata: annotated,
      schemaTableCount: countTables(annotated),
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

export { countTables };
