import { Hono } from "hono";
import {
  clearSessionCookie,
  createSessionToken,
  getSessionUser,
  loginUser,
  registerUser,
  requireAuth,
  setSessionCookie,
} from "../auth.js";

export const authRoutes = new Hono();

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return c.json({ error: "Username and password are required." }, 400);
  }
  if (username.length < 3) {
    return c.json({ error: "Username must be at least 3 characters." }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters." }, 400);
  }

  try {
    const user = await registerUser(username, password);
    const token = await createSessionToken(user.id, user.username);
    setSessionCookie(c, token);
    return c.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Registration failed.";
    return c.json({ error: message }, 400);
  }
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return c.json({ error: "Username and password are required." }, 400);
  }

  try {
    const user = await loginUser(username, password);
    const token = await createSessionToken(user.id, user.username);
    setSessionCookie(c, token);
    return c.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    return c.json({ error: message }, 401);
  }
});

authRoutes.post("/logout", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

export async function authMiddleware(c: Parameters<typeof requireAuth>[0], next: () => Promise<void>) {
  const user = await requireAuth(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
}
