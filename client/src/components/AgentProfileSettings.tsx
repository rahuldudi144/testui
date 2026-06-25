import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  activateAgentProfile,
  createAgentProfile,
  deleteAgentProfile,
  listAgents,
  updateAgentProfile,
  type LlmProvider,
  type UserAgent,
} from "../api";
import { cn } from "../lib/cn";
import { Alert } from "./ui/Alert";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EmptyState } from "./ui/EmptyState";
import { FormField } from "./ui/FormField";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Skeleton } from "./ui/Skeleton";
import { Textarea } from "./ui/Textarea";

interface Props {
  onAgentChange?: () => void;
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  ollama: "Ollama",
};

function providerLabel(provider: string | null): string {
  if (provider === "openai" || provider === "ollama") {
    return PROVIDER_LABELS[provider];
  }
  return "Server default";
}

function baseUrlLabel(provider: LlmProvider): string {
  return provider === "ollama" ? "Ollama base URL" : "OpenAI base URL (optional)";
}

function ProviderSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: LlmProvider;
  onChange: (value: LlmProvider) => void;
}) {
  return (
    <select
      id={id}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as LlmProvider)}
    >
      <option value="openai">OpenAI</option>
      <option value="ollama">Ollama</option>
    </select>
  );
}

export function AgentProfileSettings({ onAgentChange }: Props) {
  const [agents, setAgents] = useState<UserAgent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAgent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  const addFormRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("Default agent");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("openai");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const [editName, setEditName] = useState("");
  const [editSystemPrompt, setEditSystemPrompt] = useState("");
  const [editProvider, setEditProvider] = useState<LlmProvider>("openai");
  const [editModelName, setEditModelName] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 5000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listAgents();
      setAgents(data.agents);
      setActiveId(data.activeAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createAgentProfile({
        name,
        systemPrompt: systemPrompt.trim() || undefined,
        llmProvider: provider,
        modelName: modelName.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        setActive: true,
      });
      setSuccess("Agent saved and set as active.");
      setName("Default agent");
      setSystemPrompt("");
      setProvider("openai");
      setModelName("");
      setApiKey("");
      setBaseUrl("");
      await refresh();
      onAgentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    setError(null);
    setSuccess(null);
    try {
      await activateAgentProfile(id);
      setActiveId(id);
      setSuccess("Active agent updated.");
      onAgentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate agent.");
    }
  }

  function startEdit(agent: UserAgent) {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditSystemPrompt(agent.systemPrompt ?? "");
    setEditProvider(agent.llmProvider ?? "openai");
    setEditModelName(agent.modelName ?? "");
    setEditBaseUrl(agent.baseUrl ?? "");
    setEditApiKey("");
    setExpandedId(agent.id);
  }

  async function handleSaveEdit(agent: UserAgent) {
    setSavingEditId(agent.id);
    setError(null);
    setSuccess(null);
    try {
      await updateAgentProfile(agent.id, {
        name: editName,
        systemPrompt: editSystemPrompt,
        llmProvider: editProvider,
        modelName: editModelName.trim() || null,
        baseUrl: editBaseUrl.trim() || null,
        // Empty leaves the stored key untouched on the server.
        apiKey: editApiKey.trim() || undefined,
      });
      setEditingId(null);
      setSuccess("Agent updated.");
      await refresh();
      onAgentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent.");
    } finally {
      setSavingEditId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAgentProfile(deleteTarget.id);
      setSuccess("Agent profile deleted.");
      setDeleteTarget(null);
      if (expandedId === deleteTarget.id) setExpandedId(null);
      if (editingId === deleteTarget.id) setEditingId(null);
      await refresh();
      onAgentChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent.");
    } finally {
      setDeleting(false);
    }
  }

  const active = agents.find((a) => a.id === activeId) ?? null;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Agent profiles</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store the LLM provider, model, credentials, and system prompt per agent
          profile. The active profile drives chat and workflow tests.
        </p>
      </div>

      {active ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <Badge variant="info" className="normal-case">
              Agent
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{active.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {providerLabel(active.llmProvider)}
                {active.modelName ? ` · ${active.modelName}` : " · default model"}
                {" · "}
                {active.hasSystemPrompt
                  ? "custom system prompt"
                  : "no system prompt"}
              </p>
            </div>
            <Badge variant="success" className="normal-case">
              Active
            </Badge>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="warning" title="No active agent">
          Add an agent profile below or the server will run without a stored
          system prompt.
        </Alert>
      )}

      {error && (
        <Alert variant="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <div className="grid w-full gap-6 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader>
          <CardTitle>Saved agents</CardTitle>
          <CardDescription>Manage agent profiles, LLM config, and system prompts</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No agent profiles saved"
              description="Create your first agent with a system prompt for SQL generation behavior."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addFormRef.current?.scrollIntoView({ behavior: "smooth" })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add agent
                </Button>
              }
              className="py-6"
            />
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => {
                const expanded = expandedId === agent.id;
                const editing = editingId === agent.id;

                return (
                  <div
                    key={agent.id}
                    className={cn(
                      "overflow-hidden rounded-lg border transition-colors duration-150",
                      agent.id === activeId
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-background",
                    )}
                  >
                    <div className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : agent.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left focus-ring rounded-md"
                          aria-expanded={expanded}
                        >
                          {expanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              {agent.id === activeId && (
                                <Badge variant="success" className="normal-case">
                                  Active
                                </Badge>
                              )}
                              {agent.hasSystemPrompt && (
                                <Badge variant="outline" className="normal-case">
                                  System prompt set
                                </Badge>
                              )}
                              <Badge variant="outline" className="normal-case">
                                {providerLabel(agent.llmProvider)}
                                {agent.modelName ? ` · ${agent.modelName}` : ""}
                              </Badge>
                            </span>
                            <span className="mt-1 block font-medium text-foreground">
                              {agent.name}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              Updated {new Date(agent.updatedAt).toLocaleString()}
                            </span>
                          </span>
                        </button>
                        <div className="flex flex-wrap gap-2">
                          {agent.id !== activeId && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleActivate(agent.id)}
                            >
                              Set active
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => (editing ? setEditingId(null) : startEdit(agent))}
                          >
                            {editing ? "Cancel edit" : "Edit"}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteTarget(agent)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="space-y-4 border-t border-border bg-muted/10 p-4">
                        {editing ? (
                          <div className="grid w-full gap-4">
                            <FormField>
                              <Label htmlFor={`edit-agent-name-${agent.id}`}>Name</Label>
                              <Input
                                id={`edit-agent-name-${agent.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                            </FormField>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <FormField>
                                <Label htmlFor={`edit-agent-provider-${agent.id}`}>
                                  LLM provider
                                </Label>
                                <ProviderSelect
                                  id={`edit-agent-provider-${agent.id}`}
                                  value={editProvider}
                                  onChange={setEditProvider}
                                />
                              </FormField>
                              <FormField>
                                <Label htmlFor={`edit-agent-model-${agent.id}`}>
                                  Model name
                                </Label>
                                <Input
                                  id={`edit-agent-model-${agent.id}`}
                                  value={editModelName}
                                  onChange={(e) => setEditModelName(e.target.value)}
                                  placeholder={
                                    editProvider === "ollama" ? "llama3.1" : "gpt-4o-mini"
                                  }
                                />
                              </FormField>
                            </div>
                            <FormField>
                              <Label htmlFor={`edit-agent-base-url-${agent.id}`}>
                                {baseUrlLabel(editProvider)}
                              </Label>
                              <Input
                                id={`edit-agent-base-url-${agent.id}`}
                                value={editBaseUrl}
                                onChange={(e) => setEditBaseUrl(e.target.value)}
                                placeholder={
                                  editProvider === "ollama"
                                    ? "http://127.0.0.1:11434"
                                    : "https://api.openai.com/v1"
                                }
                              />
                            </FormField>
                            {editProvider === "openai" && (
                              <FormField>
                                <Label htmlFor={`edit-agent-api-key-${agent.id}`}>
                                  API key
                                </Label>
                                <Input
                                  id={`edit-agent-api-key-${agent.id}`}
                                  type="password"
                                  value={editApiKey}
                                  onChange={(e) => setEditApiKey(e.target.value)}
                                  placeholder={
                                    agent.hasApiKey
                                      ? "Leave blank to keep existing key"
                                      : "sk-…"
                                  }
                                />
                                <p className="text-xs text-muted-foreground">
                                  {agent.hasApiKey
                                    ? "A key is stored. Enter a new value only to replace it."
                                    : "Leave blank to use the server's environment key."}
                                </p>
                              </FormField>
                            )}
                            <FormField>
                              <Label htmlFor={`edit-agent-prompt-${agent.id}`}>
                                System prompt
                              </Label>
                              <Textarea
                                id={`edit-agent-prompt-${agent.id}`}
                                value={editSystemPrompt}
                                onChange={(e) => setEditSystemPrompt(e.target.value)}
                                rows={10}
                                placeholder="You are a SQL assistant for…"
                              />
                            </FormField>
                            <Button
                              type="button"
                              loading={savingEditId === agent.id}
                              onClick={() => void handleSaveEdit(agent)}
                            >
                              Save changes
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <dl className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">
                                  Provider
                                </dt>
                                <dd className="text-sm text-foreground">
                                  {providerLabel(agent.llmProvider)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">
                                  Model
                                </dt>
                                <dd className="text-sm text-foreground">
                                  {agent.modelName || "Server default"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">
                                  Base URL
                                </dt>
                                <dd className="text-sm break-all text-foreground">
                                  {agent.baseUrl || "Default"}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">
                                  API key
                                </dt>
                                <dd className="text-sm text-foreground">
                                  {agent.hasApiKey ? "Stored" : "Server default"}
                                </dd>
                              </div>
                            </dl>
                            <div className="space-y-2">
                              <Label>System prompt</Label>
                              {agent.systemPrompt?.trim() ? (
                                <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                                  {agent.systemPrompt}
                                </pre>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  No system prompt configured.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={addFormRef}>
        <CardHeader>
          <CardTitle>Add agent</CardTitle>
          <CardDescription>
            Configure the LLM provider, model, credentials, and a base system
            prompt for the SQL agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="grid w-full gap-4">
            <FormField>
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField>
                <Label htmlFor="agent-provider">LLM provider</Label>
                <ProviderSelect
                  id="agent-provider"
                  value={provider}
                  onChange={setProvider}
                />
              </FormField>
              <FormField>
                <Label htmlFor="agent-model">Model name</Label>
                <Input
                  id="agent-model"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={provider === "ollama" ? "llama3.1" : "gpt-4o-mini"}
                />
              </FormField>
            </div>

            <FormField>
              <Label htmlFor="agent-base-url">{baseUrlLabel(provider)}</Label>
              <Input
                id="agent-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  provider === "ollama"
                    ? "http://127.0.0.1:11434"
                    : "https://api.openai.com/v1"
                }
              />
            </FormField>

            {provider === "openai" && (
              <FormField>
                <Label htmlFor="agent-api-key">API key</Label>
                <Input
                  id="agent-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use the server's environment key.
                </p>
              </FormField>
            )}

            <FormField>
              <Label htmlFor="agent-system-prompt">System prompt</Label>
              <Textarea
                id="agent-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={10}
                placeholder="You are a helpful SQL assistant. Prefer read-only queries unless asked otherwise…"
              />
              <p className="text-xs text-muted-foreground">
                Used as the agent base system prompt when this profile is active.
              </p>
            </FormField>

            <Button type="submit" loading={saving}>
              Save & set active
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete agent profile?"
        description={
          deleteTarget?.id === activeId
            ? `"${deleteTarget.name}" is your active agent. Deleting it will fall back to another profile or server defaults.`
            : `Remove "${deleteTarget?.name ?? "this agent"}" from your saved profiles?`
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
