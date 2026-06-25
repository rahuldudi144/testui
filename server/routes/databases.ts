import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  getActiveDatabaseForUser,
  parseDbHost,
  setActiveDatabase,
  toPublicDatabase,
  validateDbType,
} from "../userDatabase.js";
import { syncConnectionSchema, fetchAndParseConnectionSchema } from "../syncConnectionSchema.js";
import { getActiveAgentForUser, profileAgentConfig } from "../userAgent.js";
import { testDatabaseConnection } from "../agent.js";
import { errorMessage } from "../../../utils/errors.js";

type AuthUser = { id: string; username: string; createdAt: Date };

export const databaseRoutes = new Hono<{ Variables: { user: AuthUser } }>();

databaseRoutes.use("*", authMiddleware);

databaseRoutes.get("/", async (c) => {
  const user = c.get("user");
  const [connections, active] = await Promise.all([
    prisma.databaseConnection.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    getActiveDatabaseForUser(user.id),
  ]);

  return c.json({
    databases: connections.map(toPublicDatabase),
    activeDatabaseId: active?.id ?? null,
  });
});

databaseRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name?: string;
    dbType?: string;
    dbUri?: string;
    businessContext?: string;
    setActive?: boolean;
    fetchSchema?: boolean;
    dbMetadata?: unknown;
  }>();

  const name = body.name?.trim();
  const dbUri = body.dbUri?.trim();
  const dbType = body.dbType?.trim();
  const businessContext = body.businessContext?.trim() || null;
  const fetchSchema = body.fetchSchema ?? true;

  if (!name || !dbUri || !dbType) {
    return c.json({ error: "Name, dbType, and dbUri are required." }, 400);
  }
  if (!validateDbType(dbType)) {
    return c.json({ error: "dbType must be postgres or mysql." }, 400);
  }

  try {
    await testDatabaseConnection(dbType, dbUri);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not connect to database.";
    return c.json({ error: `Connection test failed: ${message}` }, 400);
  }

  const existingCount = await prisma.databaseConnection.count({
    where: { userId: user.id },
  });

  const connection = await prisma.databaseConnection.create({
    data: {
      userId: user.id,
      name,
      dbType,
      dbUri,
      businessContext,
      schemaSyncStatus: fetchSchema ? "syncing" : "idle",
    },
  });

  if (body.setActive ?? existingCount === 0) {
    await setActiveDatabase(user.id, connection.id);
  }

  if (fetchSchema) {
    try {
      if (body.dbMetadata !== undefined) {
        await prisma.databaseConnection.update({
          where: { id: connection.id },
          data: {
            dbMetadata: body.dbMetadata as Prisma.InputJsonValue,
            schemaSyncedAt: new Date(),
            schemaSyncStatus: "ready",
            schemaSyncError: null,
          },
        });
      } else {
        await syncConnectionSchema(connection.id, user.id);
      }
    } catch (error) {
      const updated = await prisma.databaseConnection.findUnique({
        where: { id: connection.id },
      });
      return c.json(
        {
          database: toPublicDatabase(updated ?? connection),
          warning: `Connection saved but schema sync failed: ${errorMessage(error)}`,
        },
        201,
      );
    }
  }

  const saved = await prisma.databaseConnection.findUnique({
    where: { id: connection.id },
  });

  return c.json({ database: toPublicDatabase(saved ?? connection) }, 201);
});

databaseRoutes.post("/preview-schema", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ dbType?: string; dbUri?: string }>();
  const dbUri = body.dbUri?.trim();
  const dbType = body.dbType?.trim();

  if (!dbUri || !dbType) {
    return c.json({ error: "dbType and dbUri are required." }, 400);
  }
  if (!validateDbType(dbType)) {
    return c.json({ error: "dbType must be postgres or mysql." }, 400);
  }

  try {
    await testDatabaseConnection(dbType, dbUri);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not connect to database.";
    return c.json({ error: `Connection test failed: ${message}` }, 400);
  }

  try {
    const activeAgent = await getActiveAgentForUser(user.id);
    const preview = await fetchAndParseConnectionSchema(
      dbType,
      dbUri,
      profileAgentConfig(activeAgent),
    );
    return c.json(preview);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 500);
  }
});

databaseRoutes.get("/:id/schema", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const connection = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
    select: {
      dbMetadata: true,
      schemaSyncStatus: true,
      schemaSyncedAt: true,
      schemaSyncError: true,
    },
  });
  if (!connection) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  return c.json({
    dbMetadata: connection.dbMetadata ?? null,
    schemaSyncStatus: connection.schemaSyncStatus ?? "idle",
    schemaSyncedAt: connection.schemaSyncedAt?.toISOString() ?? null,
    schemaSyncError: connection.schemaSyncError ?? null,
  });
});

databaseRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    dbType?: string;
    dbUri?: string;
    businessContext?: string;
    dbMetadata?: unknown;
  }>();

  const existing = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  const name = body.name?.trim() ?? existing.name;
  const dbType = body.dbType?.trim() ?? existing.dbType;
  const dbUri = body.dbUri?.trim() ?? existing.dbUri;
  const businessContext =
    body.businessContext !== undefined
      ? body.businessContext.trim() || null
      : existing.businessContext;

  if (!validateDbType(dbType)) {
    return c.json({ error: "dbType must be postgres or mysql." }, 400);
  }

  const uriChanged = dbUri !== existing.dbUri || dbType !== existing.dbType;

  if (uriChanged) {
    try {
      await testDatabaseConnection(dbType as "postgres" | "mysql", dbUri);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not connect to database.";
      return c.json({ error: `Connection test failed: ${message}` }, 400);
    }
  }

  const connection = await prisma.databaseConnection.update({
    where: { id },
    data: {
      name,
      dbType,
      dbUri,
      businessContext,
      ...(body.dbMetadata !== undefined
        ? {
            dbMetadata: body.dbMetadata as Prisma.InputJsonValue,
            schemaSyncedAt: new Date(),
            schemaSyncStatus: "ready",
            schemaSyncError: null,
          }
        : uriChanged
          ? {
              dbMetadata: null,
              schemaSyncedAt: null,
              schemaSyncStatus: "idle",
              schemaSyncError: null,
            }
          : {}),
    },
  });

  return c.json({ database: toPublicDatabase(connection) });
});

databaseRoutes.post("/:id/sync-schema", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  try {
    await syncConnectionSchema(id, user.id);
  } catch (error) {
    const updated = await prisma.databaseConnection.findUnique({ where: { id } });
    return c.json(
      {
        error: errorMessage(error),
        database: toPublicDatabase(updated ?? existing),
      },
      500,
    );
  }

  const connection = await prisma.databaseConnection.findUnique({ where: { id } });
  return c.json({ database: toPublicDatabase(connection ?? existing) });
});

databaseRoutes.post("/:id/activate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  try {
    const connection = await setActiveDatabase(user.id, id);
    return c.json({ database: toPublicDatabase(connection) });
  } catch {
    return c.json({ error: "Database connection not found." }, 404);
  }
});

databaseRoutes.post("/test", async (c) => {
  const body = await c.req.json<{ dbType?: string; dbUri?: string }>();
  const dbUri = body.dbUri?.trim();
  const dbType = body.dbType?.trim();

  if (!dbUri || !dbType) {
    return c.json({ error: "dbType and dbUri are required." }, 400);
  }
  if (!validateDbType(dbType)) {
    return c.json({ error: "dbType must be postgres or mysql." }, 400);
  }

  try {
    await testDatabaseConnection(dbType, dbUri);
    return c.json({ ok: true, host: parseDbHost(dbUri) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not connect to database.";
    return c.json({ error: message }, 400);
  }
});

databaseRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  await prisma.databaseConnection.delete({ where: { id } });

  const userRecord = await prisma.user.findUnique({ where: { id: user.id } });
  if (userRecord?.activeDatabaseId === id) {
    const fallback = await prisma.databaseConnection.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { activeDatabaseId: fallback?.id ?? null },
    });
  }

  return c.json({ ok: true });
});
