import type { DatabaseType } from "../../types/index.js";
import { prisma } from "./db.js";
import { loadEnv } from "./env.js";

export type SchemaSyncStatus = "idle" | "syncing" | "ready" | "failed";

export function countTables(metadata: unknown): number {
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

export interface UserDatabase {
  id: string;
  name: string;
  dbType: DatabaseType;
  dbUri: string;
  host: string;
  knowledgeDbUri: string | null;
  /** True when env KNOWLEDGE_DB_URI can fill in for a missing per-connection URI. */
  hasEnvKnowledgeDbUri: boolean;
  businessContext: string | null;
  schemaSyncStatus: SchemaSyncStatus;
  schemaSyncedAt: string | null;
  schemaSyncError: string | null;
  schemaTableCount: number;
  hasBusinessContext: boolean;
  createdAt: string;
  updatedAt: string;
}

export function parseDbHost(dbUri: string): string {
  try {
    const url = new URL(dbUri);
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname}${port}${url.pathname}`;
  } catch {
    return "invalid-uri";
  }
}

export function resolveKnowledgeDbUri(connection: {
  knowledgeDbUri?: string | null;
}): string {
  const fromConnection = connection.knowledgeDbUri?.trim();
  if (fromConnection) return fromConnection;

  const fromEnv = loadEnv().KNOWLEDGE_DB_URI?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "Knowledge database URI is not configured. Set KNOWLEDGE_DB_URI or add a knowledge DB URI on this connection.",
  );
}

/** InvokeInput knowledge fields derived from a stored connection + user. */
export function connectionAgentInvokeInput(connection: {
  id: string;
  knowledgeDbUri?: string | null;
  businessContext?: string | null;
}, userId: string): {
  knowledgeDbUri: string;
  userId: string;
  databaseId: string;
  businessSummary?: string;
} {
  const businessSummary = connection.businessContext?.trim();
  return {
    knowledgeDbUri: resolveKnowledgeDbUri(connection),
    userId,
    databaseId: connection.id,
    businessSummary: businessSummary || undefined,
  };
}

export function toPublicDatabase(row: {
  id: string;
  name: string;
  dbType: string;
  dbUri: string;
  knowledgeDbUri?: string | null;
  businessContext?: string | null;
  dbMetadata?: unknown;
  schemaSyncStatus?: string;
  schemaSyncedAt?: Date | null;
  schemaSyncError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UserDatabase {
  const businessContext = row.businessContext ?? null;
  const knowledgeDbUri = row.knowledgeDbUri?.trim() || null;
  return {
    id: row.id,
    name: row.name,
    dbType: row.dbType as DatabaseType,
    dbUri: row.dbUri,
    host: parseDbHost(row.dbUri),
    knowledgeDbUri,
    hasEnvKnowledgeDbUri: Boolean(loadEnv().KNOWLEDGE_DB_URI?.trim()),
    businessContext,
    schemaSyncStatus: (row.schemaSyncStatus ?? "idle") as SchemaSyncStatus,
    schemaSyncedAt: row.schemaSyncedAt?.toISOString() ?? null,
    schemaSyncError: row.schemaSyncError ?? null,
    schemaTableCount: countTables(row.dbMetadata),
    hasBusinessContext: Boolean(businessContext?.trim()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActiveDatabaseForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { activeDatabase: true },
  });

  if (!user?.activeDatabase) {
    return null;
  }

  return user.activeDatabase;
}

export async function setActiveDatabase(userId: string, databaseId: string) {
  const connection = await prisma.databaseConnection.findFirst({
    where: { id: databaseId, userId },
  });
  if (!connection) {
    throw new Error("Database connection not found.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { activeDatabaseId: databaseId },
  });

  return connection;
}

export function validateDbType(dbType: string): dbType is DatabaseType {
  return dbType === "postgres" || dbType === "mysql";
}
