import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  getActiveDatabaseForUser,
  parseDbHost,
  setActiveDatabase,
  toPublicDatabase,
  validateDbType,
} from "../userDatabase.js";
import { testDatabaseConnection } from "../agent.js";

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
    setActive?: boolean;
  }>();

  const name = body.name?.trim();
  const dbUri = body.dbUri?.trim();
  const dbType = body.dbType?.trim();

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
    data: { userId: user.id, name, dbType, dbUri },
  });

  if (body.setActive ?? existingCount === 0) {
    await setActiveDatabase(user.id, connection.id);
  }

  return c.json({ database: toPublicDatabase(connection) });
});

databaseRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    dbType?: string;
    dbUri?: string;
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

  if (!validateDbType(dbType)) {
    return c.json({ error: "dbType must be postgres or mysql." }, 400);
  }

  try {
    await testDatabaseConnection(dbType as "postgres" | "mysql", dbUri);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not connect to database.";
    return c.json({ error: `Connection test failed: ${message}` }, 400);
  }

  const connection = await prisma.databaseConnection.update({
    where: { id },
    data: { name, dbType, dbUri },
  });

  return c.json({ database: toPublicDatabase(connection) });
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
