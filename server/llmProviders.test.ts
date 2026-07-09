import { describe, expect, test } from "bun:test";
import {
  baseUrlFieldMeta,
  listProviderOptions,
  normalizeProviderInput,
  providerLabel,
  providerShowsApiKey,
} from "./llmProviders.js";

describe("normalizeProviderInput", () => {
  test("accepts known providers case-insensitively", () => {
    expect(normalizeProviderInput("GROQ")).toBe("groq");
    expect(normalizeProviderInput("anthropic")).toBe("anthropic");
  });

  test("rejects unknown providers", () => {
    expect(normalizeProviderInput("unknown-vendor")).toBeNull();
    expect(normalizeProviderInput("")).toBeNull();
    expect(normalizeProviderInput(null)).toBeNull();
  });
});

describe("providerLabel", () => {
  test("maps known providers to display labels", () => {
    expect(providerLabel("groq")).toBe("Groq");
    expect(providerLabel("gemini")).toBe("Google Gemini");
  });

  test("falls back for unknown values", () => {
    expect(providerLabel("custom")).toBe("custom");
    expect(providerLabel(null)).toBe("Server default");
  });
});

describe("listProviderOptions", () => {
  test("includes all 13 DB-Agent providers", () => {
    const options = listProviderOptions();
    expect(options.length).toBe(13);
    expect(options.map((option) => option.value)).toContain("openrouter");
    expect(options.map((option) => option.value)).toContain("ollama");
  });
});

describe("baseUrlFieldMeta", () => {
  test("ollama uses ollama-specific label", () => {
    const meta = baseUrlFieldMeta("ollama");
    expect(meta.label).toContain("Ollama");
    expect(meta.required).toBe(false);
  });

  test("vllm requires base URL", () => {
    const meta = baseUrlFieldMeta("vllm");
    expect(meta.required).toBe(true);
  });
});

describe("providerShowsApiKey", () => {
  test("ollama does not require API key field", () => {
    expect(providerShowsApiKey("ollama")).toBe(false);
  });

  test("groq requires API key field", () => {
    expect(providerShowsApiKey("groq")).toBe(true);
  });
});
