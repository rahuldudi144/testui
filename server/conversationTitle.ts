import { randomUUID } from "crypto";
import { DatabaseAgent } from "../../index.js";
import type { DatabaseType } from "../../types/index.js";
import { buildConfig, type AgentConfigOverrides } from "./agent.js";

const DEFAULT_TITLES = new Set(["New conversation", "Untitled"]);

function fallbackTitle(query: string): string {
  const trimmed = query.slice(0, 60).replace(/\s+/g, " ").trim();
  return trimmed || "New conversation";
}

export function isDefaultConversationTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  return trimmed === "" || DEFAULT_TITLES.has(trimmed);
}

export async function generateConversationTitle(
  query: string,
  conversationId: string,
  dbType: DatabaseType,
  runnerOptions?: AgentConfigOverrides,
): Promise<string> {
  try {
    const agent = new DatabaseAgent(buildConfig(dbType, runnerOptions));
    const title = await agent.generateTitle(query, {
      correlationId: conversationId,
      requestId: randomUUID(),
    });
    const trimmed = title.trim();
    return trimmed || fallbackTitle(query);
  } catch {
    return fallbackTitle(query);
  }
}
