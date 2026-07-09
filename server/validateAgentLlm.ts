import type { LlmProvider } from "../../types/index.js";
import {
  normalizeProviderInput,
  providerShowsApiKey,
  requiresApiKey,
  requiresBaseUrl,
} from "./llmProviders.js";

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

export { providerShowsApiKey };
