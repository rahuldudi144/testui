import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "./auth.js";
import {
  getActiveAgentForUser,
  setActiveAgent,
  toPublicAgent,
} from "../userAgent.js";

type AuthUser = { id: string; username: string; createdAt: Date };

interface AgentLlmBody {
  llmProvider?: string | null;
  modelName?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}

function normalizeProvider(value?: string | null): string | null {
  const provider = value?.trim().toLowerCase();
  return provider === "openai" || provider === "ollama" ? provider : null;
}

function trimToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  } & AgentLlmBody>();

  const name = body.name?.trim();
  const systemPrompt = body.systemPrompt?.trim() || null;

  if (!name) {
    return c.json({ error: "Name is required." }, 400);
  }

  const existingCount = await prisma.agentProfile.count({
    where: { userId: user.id },
  });

  const agent = await prisma.agentProfile.create({
    data: {
      userId: user.id,
      name,
      systemPrompt,
      llmProvider: normalizeProvider(body.llmProvider),
      modelName: trimToNull(body.modelName),
      apiKey: trimToNull(body.apiKey),
      baseUrl: trimToNull(body.baseUrl),
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
  } & AgentLlmBody>();

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
  const llmProvider =
    body.llmProvider !== undefined
      ? normalizeProvider(body.llmProvider)
      : existing.llmProvider;
  const modelName =
    body.modelName !== undefined ? trimToNull(body.modelName) : existing.modelName;
  const baseUrl =
    body.baseUrl !== undefined ? trimToNull(body.baseUrl) : existing.baseUrl;
  // Only overwrite the stored key when a non-empty value is provided so the
  // client can leave the field blank to keep the existing key.
  const trimmedApiKey = body.apiKey?.trim();
  const apiKey = trimmedApiKey ? trimmedApiKey : existing.apiKey;

  const agent = await prisma.agentProfile.update({
    where: { id },
    data: { name, systemPrompt, llmProvider, modelName, baseUrl, apiKey },
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

  await prisma.agentProfile.delete({ where: { id } });

  const userRecord = await prisma.user.findUnique({ where: { id: user.id } });
  if (userRecord?.activeAgentId === id) {
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
