import { describe, expect, test } from "bun:test";
import { profileAgentConfig } from "./userAgent.js";
import { formatAgentSummary } from "./workflowTestAgent.js";

describe("profileAgentConfig", () => {
  test("maps ollama baseUrl to ollamaBaseUrl", () => {
    const config = profileAgentConfig({
      llmProvider: "ollama",
      baseUrl: "http://localhost:11434",
      modelName: "llama3.1",
    });

    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.baseUrl).toBeUndefined();
    expect(config.llmProvider).toBe("ollama");
  });

  test("maps groq baseUrl to baseUrl", () => {
    const config = profileAgentConfig({
      llmProvider: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "test-key",
      modelName: "llama-3.1-8b-instant",
    });

    expect(config.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(config.ollamaBaseUrl).toBeUndefined();
    expect(config.apiKey).toBe("test-key");
  });

  test("leaves base URL fields unset when provider omitted", () => {
    const config = profileAgentConfig({
      llmProvider: "openai",
      apiKey: "sk-test",
    });

    expect(config.baseUrl).toBeUndefined();
    expect(config.ollamaBaseUrl).toBeUndefined();
  });
});

describe("formatAgentSummary", () => {
  test("includes provider and model in summary", () => {
    expect(
      formatAgentSummary({
        id: "agent-1",
        name: "Groq fast",
        llmProvider: "groq",
        modelName: "llama-3.1-8b-instant",
      }),
    ).toBe("Groq fast (groq · llama-3.1-8b-instant)");
  });
});
