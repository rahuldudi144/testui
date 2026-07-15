import type { LlmProvider } from "../../types/index.js";
import {
  normalizeProviderInput,
  providerShowsApiKey,
  requiresApiKey,
  requiresBaseUrl,
} from "./llmProviders.js";

/** Mirrors `EmbeddingProvider` from DB-Agent types (openai | local | ollama | gemini). */
export type EmbeddingProvider = "openai" | "local" | "ollama" | "gemini";

const EMBEDDING_PROVIDERS = new Set<string>([
  "openai",
  "local",
  "ollama",
  "gemini",
]);

export function normalizeEmbeddingProviderInput(
  value?: string | null,
): EmbeddingProvider | null {
  const provider = value?.trim().toLowerCase();
  if (!provider) return null;
  return EMBEDDING_PROVIDERS.has(provider)
    ? (provider as EmbeddingProvider)
    : null;
}

export function validateAgentLlmFields(input: {
  llmProvider?: string | null;
  modelName?: string | null;
  apiKey?: string | null;
  storedApiKey?: string | null;
  baseUrl?: string | null;
}): { provider: LlmProvider | null; error?: string } {
  const provider = normalizeProviderInput(input.llmProvider);
  if (input.llmProvider?.trim() && !provider) {
    return { provider: null, error: "Unsupported LLM provider." };
  }

  if (!provider) {
    return { provider: null };
  }

  const hasApiKey = Boolean(input.apiKey?.trim() || input.storedApiKey?.trim());
  if (requiresApiKey(provider) && !hasApiKey) {
    return { provider, error: `${provider} requires an API key.` };
  }

  if (requiresBaseUrl(provider) && !input.baseUrl?.trim()) {
    return { provider, error: `${provider} requires a base URL.` };
  }

  if (!input.modelName?.trim()) {
    return { provider, error: "Model name is required when a provider is set." };
  }

  return { provider };
}

/**
 * Embedding rules matching DatabaseAgent / resolveEmbeddingsConfig:
 * - openai / gemini: model optional (agent defaults); key optional if chat key present
 * - local: model + base URL required
 * - ollama: model required; base URL optional
 */
export function validateAgentEmbeddingFields(input: {
  embeddingProvider?: string | null;
  embeddingModelName?: string | null;
  embeddingApiKey?: string | null;
  storedEmbeddingApiKey?: string | null;
  embeddingBaseUrl?: string | null;
  /** Chat LLM key — openai/gemini fall back to this in DatabaseAgent. */
  chatApiKey?: string | null;
  storedChatApiKey?: string | null;
}): { provider: EmbeddingProvider | null; error?: string } {
  const provider = normalizeEmbeddingProviderInput(input.embeddingProvider);
  if (input.embeddingProvider?.trim() && !provider) {
    return {
      provider: null,
      error:
        "Unsupported embedding provider. Use openai, local, ollama, or gemini.",
    };
  }

  if (!provider) {
    return { provider: null };
  }

  if (
    (provider === "local" || provider === "ollama") &&
    !input.embeddingModelName?.trim()
  ) {
    return {
      provider,
      error: `Embedding model name is required for ${provider}.`,
    };
  }

  if (provider === "local" && !input.embeddingBaseUrl?.trim()) {
    return {
      provider,
      error: "Local embeddings require a base URL (OpenAI-compatible host).",
    };
  }

  if (provider === "openai" || provider === "gemini") {
    const hasEmbedKey = Boolean(
      input.embeddingApiKey?.trim() || input.storedEmbeddingApiKey?.trim(),
    );
    const hasChatKey = Boolean(
      input.chatApiKey?.trim() || input.storedChatApiKey?.trim(),
    );
    if (!hasEmbedKey && !hasChatKey) {
      return {
        provider,
        error: `Embedding ${provider} requires an API key (or a chat API key to fall back to).`,
      };
    }
  }

  return { provider };
}

export { providerShowsApiKey };
