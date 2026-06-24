import { DatabaseAgent } from "../../index.js";
import type { DatabaseAgentConfig, DatabaseType, LlmProvider } from "../../types/index.js";
import { createAdapter } from "../../database/createAdapter.js";
import { loadEnv } from "./env.js";

export function buildConfig(dbType: DatabaseType): DatabaseAgentConfig {
  const env = loadEnv();
  return {
    llmProvider: env.DB_AGENT_LLM_PROVIDER as LlmProvider,
    modelName: env.DB_AGENT_MODEL_NAME,
    apiKey: env.DB_AGENT_OPENAI_API_KEY,
    ollamaBaseUrl: env.DB_AGENT_OLLAMA_BASE_URL,
    dbType,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
  };
}

export function createAgent(dbType: DatabaseType, dbUri: string): DatabaseAgent {
  const agent = new DatabaseAgent(buildConfig(dbType));
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
