import { DatabaseAgent, fetchDatabaseSchema } from "../../index.js";
import type {
  DatabaseMetadata,
  DatabaseType,
  LlmProvider,
} from "../../types/index.js";
import { loadEnv, resolveEnvApiKey } from "./env.js";
import { parseDbHost } from "./userDatabase.js";

let liveSchema: DatabaseMetadata | undefined;
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

export function getLiveSchema(): DatabaseMetadata | undefined {
  return liveSchema;
}

/** Fetch the query database schema once, the same way the main app does at startup. */
export async function loadQuerySchema(): Promise<void> {
  const env = loadEnv();
  const uri = env.DB_AGENT_DB_URI?.trim() ?? "";
  if (!uri) {
    liveSchema = undefined;
    console.log("Query schema load skipped; DB_AGENT_DB_URI is not set");
    return;
  }

  const dbType = resolveDbType(uri, env.DB_AGENT_DB_TYPE);
  liveSchema = await fetchDatabaseSchema(dbType, uri);
  const tableCount = Object.keys(liveSchema.tables ?? {}).length;
  console.log(`Query schema loaded — ${tableCount} table(s), ${dbType}`);
}

export interface QueryTarget {
  id: string;
  name: string;
  dbType: DatabaseType;
  dbUri: string;
  host: string;
  knowledgeDbUri: null;
  dbMetadata: DatabaseMetadata | undefined;
  businessContext: null;
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
    dbMetadata: liveSchema,
    businessContext: null,
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
  if (!liveSchema) {
    throw new Error(
      "The query schema is not loaded. Check DB_AGENT_DB_URI and restart.",
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
