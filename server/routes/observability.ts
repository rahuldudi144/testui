import { Hono } from "hono";
import { aggregatePlatformUsage } from "../queryExecution.js";
import { authMiddleware } from "./auth.js";

type AuthUser = { id: string; username: string; createdAt: Date };

export const observabilityRoutes = new Hono<{ Variables: { user: AuthUser } }>();

observabilityRoutes.use("*", authMiddleware);

function parseDateParam(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

observabilityRoutes.get("/usage", async (c) => {
  const user = c.get("user");
  const from = parseDateParam(c.req.query("from"));
  const to = parseDateParam(c.req.query("to"));

  const usage = await aggregatePlatformUsage(user.id, from, to);
  return c.json(usage);
});
