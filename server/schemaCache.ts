/**
 * In-memory schema cache keyed by connectionId.
 * Startup live-fetches every saved connection. Later requests reuse memory,
 * then Prisma dbMetadata, then one live fetch.
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

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

/**
 * Live-fetch every saved connection before the API accepts traffic.
 * Persists dbMetadata and fills the memory cache. One unreachable database
 * is recorded as failed and does not stop the rest.
 */
export async function loadConnectionSchemas(): Promise<{
  loaded: number;
  failed: number;
}> {
  const rows = await prisma.databaseConnection.findMany({
    select: { id: true, name: true, dbType: true, dbUri: true },
  });

  let loaded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const { dbMetadata } = await fetchConnectionSchema(
        row.dbType as DatabaseType,
        row.dbUri,
      );
      if (!isDatabaseMetadata(dbMetadata)) {
        throw new Error("Live schema fetch returned an invalid schema payload.");
      }

      await prisma.databaseConnection.update({
        where: { id: row.id },
        data: {
          dbMetadata: dbMetadata as unknown as Prisma.InputJsonValue,
          schemaSyncedAt: new Date(),
          schemaSyncStatus: "ready",
          schemaSyncError: null,
        },
      });
      cache.set(row.id, dbMetadata);
      loaded += 1;
    } catch (error) {
      failed += 1;
      const message = errorText(error);
      console.warn(
        `Schema load failed for connection ${row.name} (${row.id}): ${message}`,
      );
      try {
        await prisma.databaseConnection.update({
          where: { id: row.id },
          data: {
            schemaSyncStatus: "failed",
            schemaSyncError: message,
          },
        });
      } catch (updateError) {
        console.warn(
          `Could not record schema failure for ${row.id}: ${errorText(updateError)}`,
        );
      }
    }
  }

  return { loaded, failed };
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
