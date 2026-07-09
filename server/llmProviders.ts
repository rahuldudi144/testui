import type { LlmProvider } from "../../types/index.js";
import {
  isKnownProvider,
  requiresApiKey,
  requiresBaseUrl,
  resolveProvider,
} from "../../llm/providerRegistry.js";

export type { LlmProvider };
export { isKnownProvider, requiresApiKey, requiresBaseUrl };

export interface ProviderOption {
  value: LlmProvider;
  label: string;
  group: string;
}

export interface BaseUrlFieldMeta {
  label: string;
  required: boolean;
  placeholder: string;
  hint?: string;
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
  together: "Together AI",
  fireworks: "Fireworks AI",
  deepinfra: "DeepInfra",
  openrouter: "OpenRouter",
  kilo: "Kilo AI Gateway",
  nvidia_nim: "NVIDIA NIM",
  vllm: "vLLM",
  litellm: "LiteLLM",
  ollama: "Ollama",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

const MODEL_PLACEHOLDERS: Partial<Record<LlmProvider, string>> = {
  openai: "gpt-4o-mini",
  groq: "llama-3.1-8b-instant",
  together: "meta-llama/Llama-3-8b-chat-hf",
  fireworks: "accounts/fireworks/models/llama-v3p1-8b-instruct",
  deepinfra: "meta-llama/Llama-3.1-8B-Instruct",
  openrouter: "openai/gpt-4o-mini",
  kilo: "anthropic/claude-sonnet-4.5",
  nvidia_nim: "meta/llama-3.1-8b-instruct",
  vllm: "meta-llama/Llama-3.1-8B-Instruct",
  litellm: "gpt-4o-mini",
  ollama: "llama3.1",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.0-flash",
};

const PROVIDER_GROUPS: Array<{ group: string; providers: LlmProvider[] }> = [
  {
    group: "OpenAI-compatible",
    providers: [
      "openai",
      "groq",
      "together",
      "fireworks",
      "deepinfra",
      "openrouter",
      "kilo",
      "nvidia_nim",
      "vllm",
      "litellm",
    ],
  },
  { group: "Ollama", providers: ["ollama"] },
  { group: "Anthropic", providers: ["anthropic"] },
  { group: "Google", providers: ["gemini"] },
];

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "Server default";
  if (isKnownProvider(provider)) return PROVIDER_LABELS[provider];
  return provider;
}

export function modelPlaceholder(provider: LlmProvider): string {
  return MODEL_PLACEHOLDERS[provider] ?? "model-name";
}

export function listProviderOptions(): ProviderOption[] {
  const options: ProviderOption[] = [];
  for (const { group, providers } of PROVIDER_GROUPS) {
    for (const value of providers) {
      options.push({ value, label: PROVIDER_LABELS[value], group });
    }
  }
  return options;
}

export function normalizeProviderInput(
  value?: string | null,
): LlmProvider | null {
  const provider = value?.trim().toLowerCase();
  if (!provider) return null;
  return isKnownProvider(provider) ? provider : null;
}

export function baseUrlFieldMeta(provider: LlmProvider): BaseUrlFieldMeta {
  if (provider === "ollama") {
    return {
      label: "Ollama base URL",
      required: false,
      placeholder: "http://127.0.0.1:11434",
      hint: "Defaults to http://127.0.0.1:11434 when empty.",
    };
  }

  if (requiresBaseUrl(provider)) {
    return {
      label: "Base URL",
      required: true,
      placeholder: "https://your-host/v1",
      hint: `${PROVIDER_LABELS[provider]} requires an explicit base URL.`,
    };
  }

  const preset = resolveProvider(provider).defaultBaseUrl;
  return {
    label: "Base URL (optional override)",
    required: false,
    placeholder: preset ?? "https://api.example.com/v1",
    hint: preset
      ? `Defaults to ${preset} when empty.`
      : "Optional custom API base URL.",
  };
}

export function providerShowsApiKey(provider: LlmProvider): boolean {
  return requiresApiKey(provider);
}
