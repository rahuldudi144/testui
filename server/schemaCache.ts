/**
 * In-memory schema cache keyed by connectionId for testui schema-mode chat.
 * Live fetch only on miss (or force refresh); not on every message.
 */

import type { Prisma } from "@prisma/client";
import type { DatabaseMetadata, DatabaseType } from "../../types/index.js";
import { prisma } from "./db.js";
import { fetchConnectionSchema } from "./indexConnectionKnowledge.js";

const cache = new Map<string, DatabaseMetadata>();

function isDatabaseMetadata(value: unknown): value is DatabaseMetadata {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "tables" in value &&
    typeof (value as DatabaseMetadata).tables === "object" &&
    (value as DatabaseMetadata).tables !== null &&
    !Array.isArray((value as DatabaseMetadata).tables)
  );
}

export function getCachedSchema(
  connectionId: string,
): DatabaseMetadata | undefined {
  return cache.get(connectionId);
}

export function setCachedSchema(
  connectionId: string,
  schema: DatabaseMetadata,
): void {
  cache.set(connectionId, schema);
}

export function clearCachedSchema(connectionId: string): void {
  cache.delete(connectionId);
}

/** Load Prisma dbMetadata into memory for all connections that already have it. */
export async function warmSchemaCacheFromDb(): Promise<number> {
  const rows = await prisma.databaseConnection.findMany({
    where: { dbMetadata: { not: null } },
    select: { id: true, dbMetadata: true },
  });

  let loaded = 0;
  for (const row of rows) {
    if (isDatabaseMetadata(row.dbMetadata)) {
      cache.set(row.id, row.dbMetadata);
      loaded += 1;
    }
  }
  return loaded;
}

export type EnsureSchemaConnection = {
  id: string;
  dbType: string;
  dbUri: string;
  dbMetadata?: unknown;
};

/**
 * Return schema for a connection: memory → Prisma dbMetadata → live fetch.
 * Pass `forceRefresh: true` after an explicit sync / URI change.
 */
export async function ensureConnectionSchema(
  connection: EnsureSchemaConnection,
  options?: { forceRefresh?: boolean },
): Promise<DatabaseMetadata> {
  const forceRefresh = options?.forceRefresh === true;

  if (!forceRefresh) {
    const cached = cache.get(connection.id);
    if (cached) return cached;

    if (isDatabaseMetadata(connection.dbMetadata)) {
      cache.set(connection.id, connection.dbMetadata);
      return connection.dbMetadata;
    }

    const row = await prisma.databaseConnection.findUnique({
      where: { id: connection.id },
      select: { dbMetadata: true },
    });
    if (isDatabaseMetadata(row?.dbMetadata)) {
      cache.set(connection.id, row.dbMetadata);
      return row.dbMetadata;
    }
  }

  const { dbMetadata } = await fetchConnectionSchema(
    connection.dbType as DatabaseType,
    connection.dbUri,
  );

  if (!isDatabaseMetadata(dbMetadata)) {
    throw new Error("Live schema fetch returned an invalid schema payload.");
  }

  await prisma.databaseConnection.update({
    where: { id: connection.id },
    data: {
      dbMetadata: dbMetadata as unknown as Prisma.InputJsonValue,
      schemaSyncedAt: new Date(),
      schemaSyncStatus: "ready",
      schemaSyncError: null,
    },
  });

  cache.set(connection.id, dbMetadata);
  return dbMetadata;
}
