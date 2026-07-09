import { z } from "zod";
import {
  isKnownProvider,
  requiresApiKey,
  requiresBaseUrl,
  type LlmProvider,
} from "./llmProviders.js";

const LLM_PROVIDERS = [
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
  "ollama",
  "anthropic",
  "gemini",
] as const satisfies readonly LlmProvider[];

const envSchema = z
  .object({
    TESTUI_DATABASE_URL: z.string().min(1),
    TESTUI_SESSION_SECRET: z.string().min(16),
    TESTUI_PORT: z.coerce.number().default(4000),
    DB_AGENT_LLM_PROVIDER: z
      .string()
      .default("openai")
      .refine((value) => isKnownProvider(value), {
        message:
          "DB_AGENT_LLM_PROVIDER must be one of: openai, groq, together, fireworks, deepinfra, openrouter, kilo, nvidia_nim, vllm, litellm, ollama, anthropic, gemini",
      })
      .transform((value) => value as LlmProvider),
    /** Preferred API key for any provider that requires one. */
    DB_AGENT_API_KEY: z.string().optional(),
    /** Backward-compatible alias for DB_AGENT_API_KEY (OpenAI-era name). */
    DB_AGENT_OPENAI_API_KEY: z.string().optional(),
    DB_AGENT_MODEL_NAME: z.string().default("gpt-4o-mini"),
    /** Custom base URL for OpenAI-compatible / Anthropic / Gemini adapters. */
    DB_AGENT_BASE_URL: z.string().optional(),
    DB_AGENT_OLLAMA_BASE_URL: z.string().optional(),
    DB_AGENT_DB_TYPE: z.enum(["postgres", "mysql"]).optional(),
    DB_AGENT_DB_URI: z.string().optional(),
    DB_AGENT_READ_ONLY: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    DB_AGENT_MAX_VALIDATION_RETRIES: z.coerce.number().default(3),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const apiKey =
      data.DB_AGENT_API_KEY?.trim() || data.DB_AGENT_OPENAI_API_KEY?.trim();

    if (requiresApiKey(data.DB_AGENT_LLM_PROVIDER) && !apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `DB_AGENT_API_KEY is required when DB_AGENT_LLM_PROVIDER is ${data.DB_AGENT_LLM_PROVIDER}`,
        path: ["DB_AGENT_API_KEY"],
      });
    }

    if (
      requiresBaseUrl(data.DB_AGENT_LLM_PROVIDER) &&
      !data.DB_AGENT_BASE_URL?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `DB_AGENT_BASE_URL is required when DB_AGENT_LLM_PROVIDER is ${data.DB_AGENT_LLM_PROVIDER}`,
        path: ["DB_AGENT_BASE_URL"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export { LLM_PROVIDERS };

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new Error(`Invalid environment: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** Resolved API key from env (DB_AGENT_API_KEY, then legacy DB_AGENT_OPENAI_API_KEY). */
export function resolveEnvApiKey(env: Env = loadEnv()): string | undefined {
  const key = env.DB_AGENT_API_KEY?.trim() || env.DB_AGENT_OPENAI_API_KEY?.trim();
  return key || undefined;
}

export function isProduction(): boolean {
  return loadEnv().NODE_ENV === "production";
}
