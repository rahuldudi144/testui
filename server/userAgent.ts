import type {
  EmbeddingProvider as CoreEmbeddingProvider,
  LlmProvider,
} from "../../types/index.js";
import type { AgentConfigOverrides } from "./agent.js";
import { prisma } from "./db.js";
import { normalizeEmbeddingProviderInput } from "./validateAgentLlm.js";

function resolveOllamaEmbeddingBaseUrl(
  baseUrl?: string | null,
): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  // Native OllamaEmbeddings expects host without /v1 suffix.
  return trimmed.replace(/\/v1\/?$/, "");
}

export interface UserAgent {
  id: string;
  name: string;
  systemPrompt: string | null;
  hasSystemPrompt: boolean;
  llmProvider: string | null;
  modelName: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  embeddingProvider: string | null;
  embeddingModelName: string | null;
  embeddingBaseUrl: string | null;
  hasEmbeddingApiKey: boolean;
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
  embeddingProvider?: string | null;
  embeddingModelName?: string | null;
  embeddingApiKey?: string | null;
  embeddingBaseUrl?: string | null;
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
    embeddingProvider: row.embeddingProvider ?? null,
    embeddingModelName: row.embeddingModelName ?? null,
    embeddingBaseUrl: row.embeddingBaseUrl ?? null,
    hasEmbeddingApiKey: Boolean(row.embeddingApiKey?.trim()),
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
    embeddingProvider?: string | null;
    embeddingModelName?: string | null;
    embeddingApiKey?: string | null;
    embeddingBaseUrl?: string | null;
  } | null,
): AgentConfigOverrides {
  const systemPrompt = agent?.systemPrompt?.trim();
  const provider = agent?.llmProvider?.trim() as LlmProvider | undefined;
  const modelName = agent?.modelName?.trim();
  const apiKey = agent?.apiKey?.trim();
  const baseUrl = agent?.baseUrl?.trim();

  const embeddingProvider = normalizeEmbeddingProviderInput(
    agent?.embeddingProvider,
  ) as CoreEmbeddingProvider | null;
  const embeddingModelName = agent?.embeddingModelName?.trim();
  const embeddingApiKey = agent?.embeddingApiKey?.trim();
  const rawEmbeddingBaseUrl = agent?.embeddingBaseUrl?.trim();
  const embeddingBaseUrl =
    embeddingProvider === "ollama"
      ? resolveOllamaEmbeddingBaseUrl(rawEmbeddingBaseUrl)
      : rawEmbeddingBaseUrl || undefined;

  return {
    systemPrompt: systemPrompt || undefined,
    llmProvider: provider || undefined,
    modelName: modelName || undefined,
    apiKey: apiKey || undefined,
    ollamaBaseUrl: provider === "ollama" ? baseUrl || undefined : undefined,
    baseUrl:
      provider && provider !== "ollama" ? baseUrl || undefined : undefined,
    embeddingProvider: embeddingProvider || undefined,
    embeddingModelName: embeddingModelName || undefined,
    embeddingApiKey: embeddingApiKey || undefined,
    embeddingBaseUrl,
  };
}

export interface AgentSnapshot {
  id: string;
  name: string;
  llmProvider: string | null;
  modelName: string | null;
}

export function toAgentSnapshot(agent: {
  id: string;
  name: string;
  llmProvider?: string | null;
  modelName?: string | null;
}): AgentSnapshot {
  return {
    id: agent.id,
    name: agent.name,
    llmProvider: agent.llmProvider ?? null,
    modelName: agent.modelName ?? null,
  };
}
