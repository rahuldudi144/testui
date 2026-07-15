import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  getActiveAgentForUser,
  setActiveAgent,
  toPublicAgent,
} from "../userAgent.js";
import { normalizeProviderInput } from "../llmProviders.js";
import {
  normalizeEmbeddingProviderInput,
  validateAgentEmbeddingFields,
  validateAgentLlmFields,
} from "../validateAgentLlm.js";

type AuthUser = { id: string; username: string; createdAt: Date };

interface AgentLlmBody {
  llmProvider?: string | null;
  modelName?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}

interface AgentEmbeddingBody {
  embeddingProvider?: string | null;
  embeddingModelName?: string | null;
  embeddingApiKey?: string | null;
  embeddingBaseUrl?: string | null;
}

function trimToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveProviderFields(
  body: AgentLlmBody,
  existing?: {
    llmProvider?: string | null;
    modelName?: string | null;
    apiKey?: string | null;
    baseUrl?: string | null;
  },
): { error?: string; llmProvider: string | null; modelName: string | null; baseUrl: string | null } {
  const llmProvider =
    body.llmProvider !== undefined
      ? normalizeProviderInput(body.llmProvider)
      : normalizeProviderInput(existing?.llmProvider);

  if (body.llmProvider !== undefined && body.llmProvider?.trim() && !llmProvider) {
    return {
      error: "Unsupported LLM provider.",
      llmProvider: null,
      modelName: null,
      baseUrl: null,
    };
  }

  const modelName =
    body.modelName !== undefined ? trimToNull(body.modelName) : existing?.modelName ?? null;
  const baseUrl =
    body.baseUrl !== undefined ? trimToNull(body.baseUrl) : existing?.baseUrl ?? null;

  const validation = validateAgentLlmFields({
    llmProvider,
    modelName,
    apiKey: body.apiKey,
    storedApiKey: existing?.apiKey,
    baseUrl,
  });

  if (validation.error) {
    return {
      error: validation.error,
      llmProvider: validation.provider,
      modelName: modelName,
      baseUrl: baseUrl,
    };
  }

  return { llmProvider, modelName, baseUrl };
}

function resolveEmbeddingFields(
  body: AgentEmbeddingBody & { apiKey?: string | null },
  existing?: {
    embeddingProvider?: string | null;
    embeddingModelName?: string | null;
    embeddingApiKey?: string | null;
    embeddingBaseUrl?: string | null;
    apiKey?: string | null;
  },
): {
  error?: string;
  embeddingProvider: string | null;
  embeddingModelName: string | null;
  embeddingBaseUrl: string | null;
} {
  const embeddingProvider =
    body.embeddingProvider !== undefined
      ? normalizeEmbeddingProviderInput(body.embeddingProvider)
      : normalizeEmbeddingProviderInput(existing?.embeddingProvider);

  if (
    body.embeddingProvider !== undefined &&
    body.embeddingProvider?.trim() &&
    !embeddingProvider
  ) {
    return {
      error:
        "Unsupported embedding provider. Use openai, local, ollama, or gemini.",
      embeddingProvider: null,
      embeddingModelName: null,
      embeddingBaseUrl: null,
    };
  }

  const embeddingModelName =
    body.embeddingModelName !== undefined
      ? trimToNull(body.embeddingModelName)
      : existing?.embeddingModelName ?? null;
  const embeddingBaseUrl =
    body.embeddingBaseUrl !== undefined
      ? trimToNull(body.embeddingBaseUrl)
      : existing?.embeddingBaseUrl ?? null;

  const validation = validateAgentEmbeddingFields({
    embeddingProvider,
    embeddingModelName,
    embeddingApiKey: body.embeddingApiKey,
    storedEmbeddingApiKey: existing?.embeddingApiKey,
    embeddingBaseUrl,
    chatApiKey: body.apiKey,
    storedChatApiKey: existing?.apiKey,
  });

  if (validation.error) {
    return {
      error: validation.error,
      embeddingProvider: validation.provider,
      embeddingModelName,
      embeddingBaseUrl,
    };
  }

  return { embeddingProvider, embeddingModelName, embeddingBaseUrl };
}

export const agentRoutes = new Hono<{ Variables: { user: AuthUser } }>();

agentRoutes.use("*", authMiddleware);

agentRoutes.get("/", async (c) => {
  const user = c.get("user");
  const [agents, active] = await Promise.all([
    prisma.agentProfile.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    }),
    getActiveAgentForUser(user.id),
  ]);

  return c.json({
    agents: agents.map(toPublicAgent),
    activeAgentId: active?.id ?? null,
  });
});

agentRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name?: string;
    systemPrompt?: string;
    setActive?: boolean;
  } & AgentLlmBody &
    AgentEmbeddingBody>();

  const name = body.name?.trim();
  const systemPrompt = body.systemPrompt?.trim() || null;

  if (!name) {
    return c.json({ error: "Name is required." }, 400);
  }

  const providerFields = resolveProviderFields(body);
  if (providerFields.error) {
    return c.json({ error: providerFields.error }, 400);
  }

  const embeddingFields = resolveEmbeddingFields(body);
  if (embeddingFields.error) {
    return c.json({ error: embeddingFields.error }, 400);
  }

  const existingCount = await prisma.agentProfile.count({
    where: { userId: user.id },
  });

  const agent = await prisma.agentProfile.create({
    data: {
      userId: user.id,
      name,
      systemPrompt,
      llmProvider: providerFields.llmProvider,
      modelName: providerFields.modelName,
      apiKey: trimToNull(body.apiKey),
      baseUrl: providerFields.baseUrl,
      embeddingProvider: embeddingFields.embeddingProvider,
      embeddingModelName: embeddingFields.embeddingModelName,
      embeddingApiKey: trimToNull(body.embeddingApiKey),
      embeddingBaseUrl: embeddingFields.embeddingBaseUrl,
    },
  });

  if (body.setActive ?? existingCount === 0) {
    await setActiveAgent(user.id, agent.id);
  }

  return c.json({ agent: toPublicAgent(agent) }, 201);
});

agentRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    systemPrompt?: string;
  } & AgentLlmBody &
    AgentEmbeddingBody>();

  const existing = await prisma.agentProfile.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Agent profile not found." }, 404);
  }

  const name = body.name?.trim() ?? existing.name;
  const systemPrompt =
    body.systemPrompt !== undefined
      ? body.systemPrompt.trim() || null
      : existing.systemPrompt;

  const providerFields = resolveProviderFields(body, existing);
  if (providerFields.error) {
    return c.json({ error: providerFields.error }, 400);
  }

  const embeddingFields = resolveEmbeddingFields(body, existing);
  if (embeddingFields.error) {
    return c.json({ error: embeddingFields.error }, 400);
  }

  const trimmedApiKey = body.apiKey?.trim();
  const apiKey = trimmedApiKey ? trimmedApiKey : existing.apiKey;

  const trimmedEmbeddingApiKey = body.embeddingApiKey?.trim();
  const embeddingApiKey = trimmedEmbeddingApiKey
    ? trimmedEmbeddingApiKey
    : existing.embeddingApiKey;

  const agent = await prisma.agentProfile.update({
    where: { id },
    data: {
      name,
      systemPrompt,
      llmProvider: providerFields.llmProvider,
      modelName: providerFields.modelName,
      baseUrl: providerFields.baseUrl,
      apiKey,
      embeddingProvider: embeddingFields.embeddingProvider,
      embeddingModelName: embeddingFields.embeddingModelName,
      embeddingBaseUrl: embeddingFields.embeddingBaseUrl,
      embeddingApiKey,
    },
  });

  return c.json({ agent: toPublicAgent(agent) });
});

agentRoutes.post("/:id/activate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  try {
    const agent = await setActiveAgent(user.id, id);
    return c.json({ agent: toPublicAgent(agent) });
  } catch {
    return c.json({ error: "Agent profile not found." }, 404);
  }
});

agentRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.agentProfile.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) {
    return c.json({ error: "Agent profile not found." }, 404);
  }

  const userRow = await prisma.user.findUnique({
    where: { id: user.id },
    select: { activeAgentId: true },
  });

  await prisma.agentProfile.delete({ where: { id } });

  if (userRow?.activeAgentId === id) {
    const fallback = await prisma.agentProfile.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { activeAgentId: fallback?.id ?? null },
    });
  }

  return c.json({ ok: true });
});
