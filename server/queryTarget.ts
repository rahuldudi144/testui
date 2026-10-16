import {
  createSchemaContextCache,
  DatabaseAgent,
  prepareSchemaContext,
  type SchemaContext,
} from "../../index.js";
import type {
  DatabaseMetadata,
  DatabaseType,
  LlmProvider,
} from "../../types/index.js";
import { loadEnv, resolveEnvApiKey } from "./env.js";
import { parseDbHost } from "./userDatabase.js";

const schemaCache = createSchemaContextCache(async () => {
  const env = loadEnv();
  const uri = env.DB_AGENT_DB_URI?.trim() ?? "";
  if (!uri) return undefined;
  return prepareSchemaContext({
    dbType: resolveDbType(uri, env.DB_AGENT_DB_TYPE),
    dbUri: uri,
    valueCatalog: { enabled: true, maxDistinct: 30, maxPromptTokens: 3000 },
  });
});

let refreshTimer: ReturnType<typeof setInterval> | undefined;
let agent: DatabaseAgent | undefined;

export function chatHistoryLimit(): number {
  return loadEnv().ASK_CHAT_HISTORY_MESSAGE_LIMIT;
}

export function capAgentMessages<T>(messages: T[] | undefined): T[] {
  const list = messages ?? [];
  const limit = chatHistoryLimit();
  if (limit <= 0) return [];
  return list.slice(-limit);
}

function resolveDbType(uri: string, explicit: string | undefined): DatabaseType {
  const configured = explicit?.trim().toLowerCase();
  if (configured === "mysql") return "mysql";
  if (configured === "postgres" || configured === "postgresql") return "postgres";
  if (uri.startsWith("mysql")) return "mysql";
  return "postgres";
}

export function getSchemaContext(): SchemaContext | undefined {
  return schemaCache.current();
}

export function getLiveSchema(): DatabaseMetadata | undefined {
  return schemaCache.current()?.liveSchema;
}

export function schemaContextSummary() {
  const ctx = schemaCache.current();
  return {
    schemaHash: ctx?.schemaHash ?? null,
    tables: ctx?.stats.tables ?? 0,
    enumColumns: ctx?.stats.enumColumns ?? 0,
    builtAt: ctx?.builtAt ?? null,
  };
}

function logSchemaReady(ctx: SchemaContext): void {
  console.log(
    `schema context ready: hash=${ctx.schemaHash} tables=${ctx.stats.tables} enumColumns=${ctx.stats.enumColumns}`,
  );
}

function startRefreshTimer(): void {
  const minutes = loadEnv().DB_AGENT_SCHEMA_REFRESH_MINUTES;
  if (minutes <= 0 || refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshQuerySchema().catch((error: unknown) => {
      console.error("Schema context refresh failed", error);
    });
  }, minutes * 60_000);
  refreshTimer.unref?.();
}

/** Rebuild the schema context and swap it in after success. */
export async function refreshQuerySchema(): Promise<SchemaContext | undefined> {
  const ctx = await schemaCache.refresh();
  if (ctx) startRefreshTimer();
  return ctx;
}

/** Single-flight load used when startup did not fill the cache. */
export async function ensureQuerySchema(): Promise<SchemaContext | undefined> {
  const uri = loadEnv().DB_AGENT_DB_URI?.trim() ?? "";
  if (!uri) return undefined;
  const existing = schemaCache.current();
  if (existing) return existing;
  try {
    const ctx = await schemaCache.load();
    if (ctx) logSchemaReady(ctx);
    return ctx;
  } catch (error) {
    console.error("Schema context lazy load failed", error);
    return undefined;
  }
}

/**
 * Load the schema context at startup.
 * A failed database does not stop the server; the first request loads it once.
 */
export async function loadQuerySchema(): Promise<void> {
  const uri = loadEnv().DB_AGENT_DB_URI?.trim() ?? "";
  if (!uri) {
    console.log("Query schema load skipped; DB_AGENT_DB_URI is not set");
    return;
  }

  const delays = [0, 500, 1500];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const ctx = await refreshQuerySchema();
      if (!ctx) return;
      logSchemaReady(ctx);
      return;
    } catch (error) {
      lastError = error;
      console.error("Schema context load failed", error);
    }
  }
  console.error(
    "Schema context unavailable after retries; will try again on first use",
    lastError,
  );
}

export interface QueryTarget {
  id: string;
  name: string;
  dbType: DatabaseType;
  dbUri: string;
  host: string;
  knowledgeDbUri: null;
  dbMetadata: DatabaseMetadata | undefined;
  businessContext: string | null;
}

export function getQueryTarget(): QueryTarget | null {
  const env = loadEnv();
  const dbUri = env.DB_AGENT_DB_URI?.trim() ?? "";
  if (!dbUri) return null;
  const dbType = resolveDbType(dbUri, env.DB_AGENT_DB_TYPE);
  return {
    id: "env-search-db",
    name: "Query database",
    dbType,
    dbUri,
    host: parseDbHost(dbUri),
    knowledgeDbUri: null,
    dbMetadata: getLiveSchema(),
    businessContext: loadEnv().DB_AGENT_BUSINESS_SUMMARY?.trim() || null,
  };
}

export function envQuerySetup() {
  const activeDb = requireQueryTarget();
  const env = loadEnv();
  return {
    activeDb,
    dbType: activeDb.dbType,
    dbInfo: {
      dbType: activeDb.dbType,
      name: activeDb.name,
      host: activeDb.host,
      ...schemaContextSummary(),
    },
    agentConfig: {
      provider: env.DB_AGENT_LLM_PROVIDER,
      model: env.DB_AGENT_MODEL_NAME,
      readOnly: env.DB_AGENT_READ_ONLY,
      maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
    },
    runnerOptions: {},
    snapshot: {
      id: "env",
      name: env.DB_AGENT_MODEL_NAME,
      llmProvider: env.DB_AGENT_LLM_PROVIDER,
      modelName: env.DB_AGENT_MODEL_NAME,
    },
  };
}

export function requireQueryTarget(): QueryTarget {
  const target = getQueryTarget();
  if (!target) {
    throw new Error(
      "DB_AGENT_DB_URI is not set. Set it in backend/.env and restart.",
    );
  }
  return target;
}

/** Same DatabaseAgent construction as the main Ask service. */
export function createQueryAgent(): DatabaseAgent {
  const target = requireQueryTarget();
  if (!agent) {
    const env = loadEnv();
    const baseUrl = env.DB_AGENT_BASE_URL?.trim();
    const ollamaBaseUrl = env.DB_AGENT_OLLAMA_BASE_URL?.trim();
    agent = new DatabaseAgent({
      llmProvider: env.DB_AGENT_LLM_PROVIDER as LlmProvider,
      modelName: env.DB_AGENT_MODEL_NAME,
      apiKey: resolveEnvApiKey(env) ?? "",
      ...(baseUrl ? { baseUrl } : {}),
      ...(ollamaBaseUrl ? { ollamaBaseUrl } : {}),
      dbType: target.dbType,
      readOnly: env.DB_AGENT_READ_ONLY,
      maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
    });
    agent.setDbUri(target.dbUri);
  }
  return agent;
}
