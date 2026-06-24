import { z } from "zod";

const envSchema = z
  .object({
    TESTUI_DATABASE_URL: z.string().min(1),
    TESTUI_SESSION_SECRET: z.string().min(16),
    TESTUI_PORT: z.coerce.number().default(4000),
    DB_AGENT_LLM_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
    DB_AGENT_OPENAI_API_KEY: z.string().optional(),
    DB_AGENT_MODEL_NAME: z.string().default("gpt-4o-mini"),
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
    if (data.DB_AGENT_LLM_PROVIDER === "openai" && !data.DB_AGENT_OPENAI_API_KEY?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DB_AGENT_OPENAI_API_KEY is required when DB_AGENT_LLM_PROVIDER is openai",
        path: ["DB_AGENT_OPENAI_API_KEY"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return loadEnv().NODE_ENV === "production";
}
