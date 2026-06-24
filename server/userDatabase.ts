import type { DatabaseType } from "../../types/index.js";
import { prisma } from "./db.js";

export interface UserDatabase {
  id: string;
  name: string;
  dbType: DatabaseType;
  dbUri: string;
  host: string;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}): UserDatabase {
  return {
    id: row.id,
    name: row.name,
    dbType: row.dbType as DatabaseType,
    dbUri: row.dbUri,
    host: parseDbHost(row.dbUri),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
