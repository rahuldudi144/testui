import type { AgentConfigOverrides } from "./agent.js";
import {
  profileAgentConfig,
  toAgentSnapshot,
  type AgentSnapshot,
} from "./userAgent.js";
import { prisma } from "./db.js";

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

export async function resolveWorkflowTestAgent(
  userId: string,
  agentProfileId?: string | null,
): Promise<ResolvedWorkflowAgent | null> {
  if (!agentProfileId) return null;

  const agent = await prisma.agentProfile.findFirst({
    where: { id: agentProfileId, userId },
  });

  if (!agent) return null;

  return {
    agent,
    runnerOptions: profileAgentConfig(agent),
    snapshot: toAgentSnapshot(agent),
  };
}

export function formatAgentSummary(snapshot: AgentSnapshot): string {
  const provider = snapshot.llmProvider ?? "default";
  const model = snapshot.modelName ?? "default model";
  return `${snapshot.name} (${provider} · ${model})`;
}
