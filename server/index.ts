import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { authRoutes } from "./routes/auth.js";
import { conversationRoutes } from "./routes/conversations.js";
import { databaseRoutes } from "./routes/databases.js";
import { agentRoutes } from "./routes/agents.js";
import { userRoutes } from "./routes/users.js";
import { workflowTestRoutes } from "./routes/workflowTest.js";
import { observabilityRoutes } from "./routes/observability.js";
import { loadEnv, isProduction } from "./env.js";
import { getSessionUser } from "./auth.js";
import fs from "fs";
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
app.route("/api/agents", agentRoutes);
app.route("/api/users", userRoutes);
app.route("/api/workflow-test", workflowTestRoutes);
app.route("/api/observability", observabilityRoutes);

if (isProduction()) {
  app.use("/*", serveStatic({ root: distDir }));
  app.get("*", serveStatic({ path: "index.html", root: distDir }));
}

const env = loadEnv();
const preferredPort = env.TESTUI_PORT;
const portFile = path.resolve(__dirname, "../.dev-api-port");

const serverHolderKey = Symbol.for("db-agent-testui.server");
type ServerHolder = { server?: ReturnType<typeof Bun.serve> };
const serverHolder: ServerHolder =
  (globalThis as typeof globalThis & Record<symbol, ServerHolder>)[
    serverHolderKey
  ] ??= {};

serverHolder.server?.stop(true);

function isAddrInUse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "EADDRINUSE") return true;
  return error instanceof Error && error.message.includes("EADDRINUSE");
}

const serveOptions = {
  fetch: app.fetch,
  // Agent runs (schema fetch + validation retries + LLM calls) can exceed 10s
  // before the first SSE chunk is written. Bun defaults to 10s idleTimeout.
  idleTimeout: 255,
  // Avoid Bun's default-export HMR path, which can leave the port bound on reload.
  development: { hmr: false },
} as const;

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({ ...serveOptions, port: preferredPort });
} catch (error) {
  if (!isAddrInUse(error)) throw error;
  server = Bun.serve({ ...serveOptions, port: 0 });
  console.log(
    `Port ${preferredPort} is in use; DB-Agent test UI API using ${server.port} instead`,
  );
}

serverHolder.server = server;
fs.writeFileSync(portFile, `${server.port}\n${process.pid}\n`);

function clearPortFile(): void {
  try {
    const [portLine, pidLine] = fs.readFileSync(portFile, "utf8").split("\n");
    if (portLine?.trim() === String(server.port) && pidLine?.trim() === String(process.pid)) {
      fs.unlinkSync(portFile);
    }
  } catch {
    // Another process already removed or replaced the file.
  }
}

process.on("exit", clearPortFile);

console.log(`DB-Agent test UI API listening on http://localhost:${server.port}`);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    server.stop(true);
    clearPortFile();
    if (serverHolder.server === server) {
      serverHolder.server = undefined;
    }
  });
}
