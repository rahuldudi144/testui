import { DatabaseAgent } from "../../index.js";
import type { DatabaseAgentConfig, DatabaseType, LlmProvider } from "../../types/index.js";
import { createAdapter } from "../../database/createAdapter.js";
import { loadEnv, resolveEnvApiKey } from "./env.js";

/** Per-request agent overrides, typically sourced from the active agent profile. */
export interface AgentConfigOverrides {
  systemPrompt?: string;
  llmProvider?: LlmProvider;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  ollamaBaseUrl?: string;
}

export function buildConfig(
  dbType: DatabaseType,
  options?: AgentConfigOverrides,
): DatabaseAgentConfig {
  const env = loadEnv();
  const systemPrompt = options?.systemPrompt?.trim();
  const provider =
    options?.llmProvider ?? (env.DB_AGENT_LLM_PROVIDER as LlmProvider);

  return {
    llmProvider: provider,
    modelName: options?.modelName ?? env.DB_AGENT_MODEL_NAME,
    apiKey: options?.apiKey ?? resolveEnvApiKey(env),
    baseUrl:
      options?.baseUrl ??
      (provider === "ollama" ? undefined : env.DB_AGENT_BASE_URL),
    ollamaBaseUrl: options?.ollamaBaseUrl ?? env.DB_AGENT_OLLAMA_BASE_URL,
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
