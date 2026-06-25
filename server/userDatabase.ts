import type { DatabaseType } from "../../types/index.js";
import { prisma } from "./db.js";
import { countTables } from "./syncConnectionSchema.js";

export type SchemaSyncStatus = "idle" | "syncing" | "ready" | "failed";

export interface UserDatabase {
  id: string;
  name: string;
  dbType: DatabaseType;
  dbUri: string;
  host: string;
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

export function toPublicDatabase(row: {
  id: string;
  name: string;
  dbType: string;
  dbUri: string;
  businessContext?: string | null;
  dbMetadata?: unknown;
  schemaSyncStatus?: string;
  schemaSyncedAt?: Date | null;
  schemaSyncError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UserDatabase {
  const businessContext = row.businessContext ?? null;
  return {
    id: row.id,
    name: row.name,
    dbType: row.dbType as DatabaseType,
    dbUri: row.dbUri,
    host: parseDbHost(row.dbUri),
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

export function connectionAgentMetadata(connection: {
  businessContext?: string | null;
  dbMetadata?: unknown;
}): {
  businessContext?: string;
  dbMetadata?: unknown;
} {
  const businessContext = connection.businessContext?.trim();
  return {
    businessContext: businessContext || undefined,
    dbMetadata: connection.dbMetadata ?? undefined,
  };
}
