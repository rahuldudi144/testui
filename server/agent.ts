import { DatabaseAgent } from "../../index.js";
import type {
  DatabaseAgentConfig,
  DatabaseType,
  EmbeddingProvider,
  LlmProvider,
} from "../../types/index.js";
import { createAdapter } from "../../database/createAdapter.js";
import { loadEnv, resolveEnvApiKey } from "./env.js";

/**
 * Per-request agent overrides, typically from the active agent profile.
 * Maps 1:1 onto {@link DatabaseAgentConfig} fields that DatabaseAgent accepts.
 */
export interface AgentConfigOverrides {
  systemPrompt?: string;
  llmProvider?: LlmProvider;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  ollamaBaseUrl?: string;
  embeddingProvider?: EmbeddingProvider;
  embeddingModelName?: string;
  embeddingApiKey?: string;
  embeddingBaseUrl?: string;
}

/**
 * Build {@link DatabaseAgentConfig} the same way a host app would construct
 * `new DatabaseAgent({ ... })` — chat LLM + optional embedding* fields.
 */
export function buildConfig(
  dbType: DatabaseType,
  options?: AgentConfigOverrides,
): DatabaseAgentConfig {
  const env = loadEnv();
  const systemPrompt = options?.systemPrompt?.trim();
  const provider =
    options?.llmProvider ?? (env.DB_AGENT_LLM_PROVIDER as LlmProvider);

  const embeddingProvider: EmbeddingProvider | undefined =
    options?.embeddingProvider ?? env.DB_AGENT_EMBEDDING_PROVIDER;

  // Profile model wins. Env model only when profile did not pick a provider
  // (so openai/gemini can use agent defaults when profile omits model).
  const embeddingModelName =
    options?.embeddingModelName?.trim() ||
    (options?.embeddingProvider
      ? undefined
      : env.DB_AGENT_EMBEDDING_MODEL?.trim() || undefined);

  const embeddingApiKey =
    options?.embeddingApiKey?.trim() ||
    env.DB_AGENT_EMBEDDING_API_KEY?.trim() ||
    undefined;
  const embeddingBaseUrl =
    options?.embeddingBaseUrl?.trim() ||
    (options?.embeddingProvider
      ? undefined
      : env.DB_AGENT_EMBEDDING_BASE_URL?.trim() || undefined) ||
    undefined;

  return {
    llmProvider: provider,
    modelName: options?.modelName ?? env.DB_AGENT_MODEL_NAME,
    apiKey: options?.apiKey ?? resolveEnvApiKey(env),
    baseUrl:
      options?.baseUrl ??
      (provider === "ollama" ? undefined : env.DB_AGENT_BASE_URL),
    ollamaBaseUrl: options?.ollamaBaseUrl ?? env.DB_AGENT_OLLAMA_BASE_URL,
    embeddingProvider,
    ...(embeddingModelName ? { embeddingModelName } : {}),
    ...(embeddingApiKey ? { embeddingApiKey } : {}),
    ...(embeddingBaseUrl ? { embeddingBaseUrl } : {}),
    dbType,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

export function createAgent(
  dbType: DatabaseType,
  dbUri: string,
  options?: AgentConfigOverrides,
): DatabaseAgent {
  const agent = new DatabaseAgent(buildConfig(dbType, options));
  agent.setDbUri(dbUri);
  return agent;
}

export async function testDatabaseConnection(
  dbType: DatabaseType,
  dbUri: string,
): Promise<void> {
  const adapter = createAdapter(dbType, dbUri);
  await adapter.connect();
  await adapter.close();
}

export { extractSqlFromMarkdown, toAgentMessages } from "./agentHelpers.js";
