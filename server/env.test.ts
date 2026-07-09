import { describe, expect, test } from "bun:test";
import { LLM_PROVIDERS } from "./env.js";

describe("LLM_PROVIDERS", () => {
  test("lists all 13 DB-Agent providers", () => {
    expect(LLM_PROVIDERS).toHaveLength(13);
    expect(LLM_PROVIDERS).toContain("openai");
    expect(LLM_PROVIDERS).toContain("groq");
    expect(LLM_PROVIDERS).toContain("ollama");
    expect(LLM_PROVIDERS).toContain("anthropic");
    expect(LLM_PROVIDERS).toContain("gemini");
    expect(LLM_PROVIDERS).toContain("nvidia_nim");
    expect(LLM_PROVIDERS).toContain("litellm");
  });
});
