import { useEffect, useState } from "react";
import {
  loadAgentRequestOptions,
  saveAgentRequestOptions,
  type AgentRequestOptions,
} from "../lib/agentRequestOptions";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Textarea } from "./ui/Textarea";

export function AgentSettings() {
  const [options, setOptions] = useState<AgentRequestOptions>(() =>
    loadAgentRequestOptions(),
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setOptions(loadAgentRequestOptions());
  }, []);

  function update<K extends keyof AgentRequestOptions>(
    key: K,
    value: AgentRequestOptions[K],
  ) {
    setSaved(false);
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveAgentRequestOptions(options);
    setSaved(true);
  }

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          LLM provider and business context sent with each chat request.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="llm-provider">Provider</Label>
        <select
          id="llm-provider"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={options.llmProvider}
          onChange={(e) =>
            update("llmProvider", e.target.value as AgentRequestOptions["llmProvider"])
          }
        >
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model-name">Model name</Label>
        <Input
          id="model-name"
          placeholder={options.llmProvider === "ollama" ? "llama3.1" : "gpt-4o-mini"}
          value={options.modelName}
          onChange={(e) => update("modelName", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to use the server default from environment.
        </p>
      </div>

      {options.llmProvider === "ollama" && (
        <div className="space-y-2">
          <Label htmlFor="ollama-base-url">Ollama base URL</Label>
          <Input
            id="ollama-base-url"
            value={options.ollamaBaseUrl}
            onChange={(e) => update("ollamaBaseUrl", e.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="business-context">Business context</Label>
        <Textarea
          id="business-context"
          rows={6}
          placeholder="Domain glossary, metric definitions, naming conventions…"
          value={options.businessContext}
          onChange={(e) => update("businessContext", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Appended to the agent system prompt for SQL generation and answers.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave}>
          Save agent settings
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  );
}
