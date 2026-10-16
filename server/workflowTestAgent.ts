import type { AgentConfigOverrides } from "./agent.js";
import {
  toAgentSnapshot,
  type AgentSnapshot,
} from "./userAgent.js";
import { loadEnv } from "./env.js";

export interface ResolvedWorkflowAgent {
  agent: {
    id: string;
    name: string;
    systemPrompt: string | null;
    llmProvider: string | null;
    modelName: string | null;
    apiKey: string | null;
    baseUrl: string | null;
  };
  runnerOptions: AgentConfigOverrides;
  snapshot: AgentSnapshot;
}

export async function resolveWorkflowTestAgent(): Promise<ResolvedWorkflowAgent> {
  const env = loadEnv();
  const agent = {
    id: "env",
    name: env.DB_AGENT_MODEL_NAME,
    systemPrompt: null,
    llmProvider: env.DB_AGENT_LLM_PROVIDER,
    modelName: env.DB_AGENT_MODEL_NAME,
    apiKey: null,
    baseUrl: env.DB_AGENT_BASE_URL ?? null,
  };
  return {
    agent,
    runnerOptions: {},
    snapshot: toAgentSnapshot(agent),
  };
}

export function formatAgentSummary(snapshot: AgentSnapshot): string {
  const provider = snapshot.llmProvider ?? "default";
  const model = snapshot.modelName ?? "default model";
  return `${snapshot.name} (${provider} · ${model})`;
}
