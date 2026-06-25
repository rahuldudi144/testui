import type { LlmProvider } from "../../types/index.js";
import type { AgentConfigOverrides } from "./agent.js";
import { prisma } from "./db.js";

export interface UserAgent {
  id: string;
  name: string;
  systemPrompt: string | null;
  hasSystemPrompt: boolean;
  llmProvider: string | null;
  modelName: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicAgent(row: {
  id: string;
  name: string;
  systemPrompt?: string | null;
  llmProvider?: string | null;
  modelName?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UserAgent {
  const systemPrompt = row.systemPrompt ?? null;
  return {
    id: row.id,
    name: row.name,
    systemPrompt,
    hasSystemPrompt: Boolean(systemPrompt?.trim()),
    llmProvider: row.llmProvider ?? null,
    modelName: row.modelName ?? null,
    baseUrl: row.baseUrl ?? null,
    hasApiKey: Boolean(row.apiKey?.trim()),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActiveAgentForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { activeAgent: true },
  });

  return user?.activeAgent ?? null;
}

export async function setActiveAgent(userId: string, agentId: string) {
  const agent = await prisma.agentProfile.findFirst({
    where: { id: agentId, userId },
  });
  if (!agent) {
    throw new Error("Agent profile not found.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { activeAgentId: agentId },
  });

  return agent;
}

export function profileAgentConfig(
  agent: {
    systemPrompt?: string | null;
    llmProvider?: string | null;
    modelName?: string | null;
    apiKey?: string | null;
    baseUrl?: string | null;
  } | null,
): AgentConfigOverrides {
  const systemPrompt = agent?.systemPrompt?.trim();
  const provider = agent?.llmProvider?.trim() as LlmProvider | undefined;
  const modelName = agent?.modelName?.trim();
  const apiKey = agent?.apiKey?.trim();
  const baseUrl = agent?.baseUrl?.trim();

  return {
    systemPrompt: systemPrompt || undefined,
    llmProvider: provider || undefined,
    modelName: modelName || undefined,
    apiKey: apiKey || undefined,
    // A single profile base URL maps to the field for the selected provider.
    baseUrl: provider === "openai" ? baseUrl || undefined : undefined,
    ollamaBaseUrl: provider === "ollama" ? baseUrl || undefined : undefined,
  };
}
