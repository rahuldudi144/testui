import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { authRoutes } from "./routes/auth.js";
import { conversationRoutes } from "./routes/conversations.js";
import { databaseRoutes } from "./routes/databases.js";
import { userRoutes } from "./routes/users.js";
import { workflowTestRoutes } from "./routes/workflowTest.js";
import { loadEnv, isProduction } from "./env.js";
import { getSessionUser } from "./auth.js";
import path from "path";
import { fileURLToPath } from "url";
import { initDebugCapture } from "./debugCapture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

initDebugCapture();

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (!isProduction()) {
        return origin.startsWith("http://localhost:") ? origin : "http://localhost:5173";
      }
      return origin;
    },
    credentials: true,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/me", async (c) => {
  const user = await getSessionUser(c);
  return c.json({ user });
});

app.route("/api/auth", authRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/databases", databaseRoutes);
app.route("/api/users", userRoutes);
app.route("/api/workflow-test", workflowTestRoutes);

if (isProduction()) {
  app.use("/*", serveStatic({ root: distDir }));
  app.get("*", serveStatic({ path: "index.html", root: distDir }));
}

const env = loadEnv();

console.log(`DB-Agent test UI API listening on http://localhost:${env.TESTUI_PORT}`);

export default {
  port: env.TESTUI_PORT,
  fetch: app.fetch,
  // Agent runs (schema fetch + validation retries + LLM calls) can exceed 10s
  // before the first SSE chunk is written. Bun defaults to 10s idleTimeout.
  idleTimeout: 255,
};
