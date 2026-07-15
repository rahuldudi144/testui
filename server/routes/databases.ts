import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  getActiveDatabaseForUser,
  parseDbHost,
  setActiveDatabase,
  toPublicDatabase,
  validateDbType,
  resolveKnowledgeDbUri,
} from "../userDatabase.js";
import {
  indexConnectionKnowledge,
} from "../indexConnectionKnowledge.js";
import { testDatabaseConnection } from "../agent.js";
import { errorMessage } from "../../../utils/errors.js";
import { isAbortError } from "../../../utils/abort.js";

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
    knowledgeDbUri?: string;
    businessContext?: string;
    setActive?: boolean;
  }>();

  const name = body.name?.trim();
  const dbUri = body.dbUri?.trim();
  const dbType = body.dbType?.trim();
  const knowledgeDbUri = body.knowledgeDbUri?.trim() || null;
  const businessContext = body.businessContext?.trim() || null;

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
      knowledgeDbUri,
      businessContext,
      schemaSyncStatus: "idle",
    },
  });

  if (body.setActive ?? existingCount === 0) {
    await setActiveDatabase(user.id, connection.id);
  }

  const saved = await prisma.databaseConnection.findUnique({
    where: { id: connection.id },
  });

  return c.json({ database: toPublicDatabase(saved ?? connection) }, 201);
});

databaseRoutes.post("/preview-schema", async (c) => {
  return c.json(
    {
      error:
        "Schema preview was removed. Use Build knowledge (POST /:id/index-knowledge) instead.",
    },
    410,
  );
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
    knowledgeDbUri?: string | null;
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
  const knowledgeDbUri =
    body.knowledgeDbUri !== undefined
      ? body.knowledgeDbUri?.trim() || null
      : existing.knowledgeDbUri;
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
      knowledgeDbUri,
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
              dbMetadata: Prisma.DbNull,
              schemaSyncedAt: null,
              schemaSyncStatus: "idle",
              schemaSyncError: null,
            }
          : {}),
    },
  });

  return c.json({ database: toPublicDatabase(connection) });
});

/** Stream knowledge indexing progress (SSE). */
databaseRoutes.post("/:id/index-knowledge", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  try {
    resolveKnowledgeDbUri(existing);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    try {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({ message: "indexing" }),
      });

      await indexConnectionKnowledge(id, user.id, {
        abortSignal: signal,
        onEvent: async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        },
      });

      if (signal.aborted) return;

      const connection = await prisma.databaseConnection.findUnique({
        where: { id },
      });
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          database: toPublicDatabase(connection ?? existing),
        }),
      });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      const updated = await prisma.databaseConnection.findUnique({
        where: { id },
      });
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: errorMessage(error),
          database: toPublicDatabase(updated ?? existing),
        }),
      });
    }
  });
});

/** Backward-compatible alias — redirects to the same indexing flow. */
databaseRoutes.post("/:id/sync-schema", async (c) => {
  // Re-enter through index-knowledge by calling the same logic via sub-request is awkward;
  // duplicate the thin auth check and forward to shared indexing helper above by path rewrite.
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.databaseConnection.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Database connection not found." }, 404);
  }

  try {
    resolveKnowledgeDbUri(existing);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;
    try {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({ message: "indexing" }),
      });

      await indexConnectionKnowledge(id, user.id, {
        abortSignal: signal,
        onEvent: async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        },
      });

      if (signal.aborted) return;

      const connection = await prisma.databaseConnection.findUnique({
        where: { id },
      });
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          database: toPublicDatabase(connection ?? existing),
        }),
      });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      const updated = await prisma.databaseConnection.findUnique({
        where: { id },
      });
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: errorMessage(error),
          database: toPublicDatabase(updated ?? existing),
        }),
      });
    }
  });
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
