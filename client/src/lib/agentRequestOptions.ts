const STORAGE_KEY = "db-agent-testui-agent-options";

export type AgentRequestOptions = {
  businessContext: string;
  llmProvider: "openai" | "ollama";
  modelName: string;
  ollamaBaseUrl: string;
};

const DEFAULTS: AgentRequestOptions = {
  businessContext: "",
  llmProvider: "openai",
  modelName: "",
  ollamaBaseUrl: "http://127.0.0.1:11434",
};

export function loadAgentRequestOptions(): AgentRequestOptions {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAgentRequestOptions(options: AgentRequestOptions): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
}
