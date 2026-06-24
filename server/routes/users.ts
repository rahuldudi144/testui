import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  hashPassword,
  registerUser,
  verifyPassword,
} from "../auth.js";

type AuthUser = { id: string; username: string; createdAt: Date };

export const userRoutes = new Hono<{ Variables: { user: AuthUser } }>();

userRoutes.use("*", authMiddleware);

userRoutes.get("/", async (c) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      username: true,
      createdAt: true,
      _count: {
        select: { conversations: true, databases: true },
      },
    },
  });
  return c.json({ users });
});

userRoutes.post("/", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return c.json({ error: "Email and password are required." }, 400);
  }
  if (username.length < 3) {
    return c.json({ error: "Email must be at least 3 characters." }, 400);
  }
  if (password.length < 4) {
    return c.json({ error: "Password must be at least 4 characters." }, 400);
  }

  try {
    const user = await registerUser(username, password);
    return c.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create user.";
    return c.json({ error: message }, 400);
  }
});

userRoutes.delete("/:id", async (c) => {
  const current = c.get("user");
  const id = c.req.param("id");

  if (id === current.id) {
    return c.json({ error: "You cannot delete your own account while logged in." }, 400);
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return c.json({ error: "User not found." }, 404);
  }

  await prisma.user.delete({ where: { id } });
  return c.json({ ok: true });
});

userRoutes.patch("/me/password", async (c) => {
  const current = c.get("user");
  const body = await c.req.json<{
    currentPassword?: string;
    newPassword?: string;
  }>();

  if (!body.currentPassword || !body.newPassword) {
    return c.json({ error: "Current and new password are required." }, 400);
  }
  if (body.newPassword.length < 4) {
    return c.json({ error: "New password must be at least 4 characters." }, 400);
  }

  const record = await prisma.user.findUnique({ where: { id: current.id } });
  if (!record) {
    return c.json({ error: "User not found." }, 404);
  }

  const valid = await verifyPassword(body.currentPassword, record.passwordHash);
  if (!valid) {
    return c.json({ error: "Current password is incorrect." }, 401);
  }

  await prisma.user.update({
    where: { id: current.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });

  return c.json({ ok: true });
});
