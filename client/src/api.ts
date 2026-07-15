import type { AgentEvent } from "./types/agentEvents";
import { isAgentEvent } from "./types/agentEvents";
import { isPublicStreamEvent } from "./lib/streamEventFilter";

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  generatedSql: string | null;
  debugData?: Record<string, unknown> | null;
  createdAt: string;
}

export type SchemaSyncStatus = "idle" | "syncing" | "ready" | "failed";

export interface UserDatabase {
  id: string;
  name: string;
  dbType: "postgres" | "mysql";
  dbUri: string;
  host: string;
  knowledgeDbUri: string | null;
  hasEnvKnowledgeDbUri: boolean;
  businessContext: string | null;
  schemaSyncStatus: SchemaSyncStatus;
  schemaSyncedAt: string | null;
  schemaSyncError: string | null;
  schemaTableCount: number;
  hasBusinessContext: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LlmProvider =
  | "openai"
  | "ollama"
  | "anthropic"
  | "gemini"
  | "nvidia_nim"
  | "groq"
  | "together"
  | "fireworks"
  | "deepinfra"
  | "openrouter"
  | "kilo"
  | "vllm"
  | "litellm";

export type EmbeddingProvider = "openai" | "local" | "ollama" | "gemini";

export interface AgentSummary {
  id: string;
  name: string;
  llmProvider: string | null;
  modelName: string | null;
}

export interface UserAgent {
  id: string;
  name: string;
  systemPrompt: string | null;
  hasSystemPrompt: boolean;
  llmProvider: string | null;
  modelName: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  embeddingProvider: string | null;
  embeddingModelName: string | null;
  embeddingBaseUrl: string | null;
  hasEmbeddingApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLlmInput {
  llmProvider?: LlmProvider | string | null;
  modelName?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
}

export interface AgentEmbeddingInput {
  embeddingProvider?: EmbeddingProvider | string | null;
  embeddingModelName?: string | null;
  embeddingApiKey?: string | null;
  embeddingBaseUrl?: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchMe(): Promise<User | null> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { user?: User | null };
  return data.user ?? null;
}

export async function login(username: string, password: string): Promise<User> {
  const data = await request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await request<{ conversations: Conversation[] }>(
    "/api/conversations",
  );
  return data.conversations;
}

export async function createConversation(
  title?: string,
): Promise<Conversation> {
  const data = await request<{ conversation: Conversation }>(
    "/api/conversations",
    { method: "POST", body: JSON.stringify({ title }) },
  );
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/api/conversations/${id}`, { method: "DELETE" });
}

export async function fetchMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    `/api/conversations/${conversationId}/messages`,
  );
  return data.messages;
}

export async function listDatabases(): Promise<{
  databases: UserDatabase[];
  activeDatabaseId: string | null;
}> {
  return request("/api/databases");
}

export async function listAgents(): Promise<{
  agents: UserAgent[];
  activeAgentId: string | null;
}> {
  return request("/api/agents");
}

export async function createAgentProfile(
  input: {
    name: string;
    systemPrompt?: string;
    setActive?: boolean;
  } & AgentLlmInput &
    AgentEmbeddingInput,
): Promise<UserAgent> {
  const data = await request<{ agent: UserAgent }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.agent;
}

export async function updateAgentProfile(
  id: string,
  input: { name?: string; systemPrompt?: string } & AgentLlmInput &
    AgentEmbeddingInput,
): Promise<UserAgent> {
  const data = await request<{ agent: UserAgent }>(`/api/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.agent;
}

export async function activateAgentProfile(id: string): Promise<UserAgent> {
  const data = await request<{ agent: UserAgent }>(`/api/agents/${id}/activate`, {
    method: "POST",
  });
  return data.agent;
}

export async function deleteAgentProfile(id: string): Promise<void> {
  await request(`/api/agents/${id}`, { method: "DELETE" });
}

export async function createDatabase(input: {
  name: string;
  dbType: "postgres" | "mysql";
  dbUri: string;
  knowledgeDbUri?: string;
  businessContext?: string;
  setActive?: boolean;
}): Promise<{ database: UserDatabase; warning?: string }> {
  const data = await request<{ database: UserDatabase; warning?: string }>(
    "/api/databases",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data;
}

export async function updateDatabase(
  id: string,
  input: {
    name?: string;
    dbType?: "postgres" | "mysql";
    dbUri?: string;
    knowledgeDbUri?: string | null;
    businessContext?: string;
    dbMetadata?: unknown;
  },
): Promise<UserDatabase> {
  const data = await request<{ database: UserDatabase }>(
    `/api/databases/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return data.database;
}

export type KnowledgeIndexEvent =
  | { type: "knowledge_progress"; table: string; completed: number; total: number }
  | { type: "knowledge_completed" }
  | { type: "knowledge_failed"; table: string; error: string }
  | { type: "status"; message: string }
  | { type: "done"; database: UserDatabase }
  | { type: "error"; message: string; database?: UserDatabase };

/** Stream knowledge indexing progress via SSE. */
export async function indexDatabaseKnowledge(
  id: string,
  options?: {
    onEvent?: (event: KnowledgeIndexEvent) => void;
    signal?: AbortSignal;
  },
): Promise<UserDatabase> {
  const res = await fetch(`/api/databases/${id}/index-knowledge`, {
    method: "POST",
    credentials: "include",
    signal: options?.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  }

  const body = res.body;
  if (!body) {
    throw new Error("Knowledge index response had no body.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalDatabase: UserDatabase | undefined;
  let lastError: string | undefined;

  const flushEvent = (rawEvent: string, rawData: string) => {
    if (!rawData) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }
    const eventType = rawEvent || (parsed as { type?: string }).type || "message";
    const payload =
      typeof parsed === "object" && parsed !== null
        ? { ...(parsed as object), type: (parsed as { type?: string }).type ?? eventType }
        : { type: eventType, data: parsed };

    const typed = payload as KnowledgeIndexEvent;
    options?.onEvent?.(typed);

    if (typed.type === "done" && "database" in typed && typed.database) {
      finalDatabase = typed.database;
    }
    if (typed.type === "error" && "message" in typed) {
      lastError = typed.message;
      if (typed.database) finalDatabase = typed.database;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = "";
      let dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      flushEvent(eventName, dataLines.join("\n"));
    }
  }

  if (lastError) {
    throw new Error(lastError);
  }
  if (!finalDatabase) {
    throw new Error("Knowledge indexing finished without a database payload.");
  }
  return finalDatabase;
}

/** @deprecated Use indexDatabaseKnowledge */
export async function syncDatabaseSchema(id: string): Promise<UserDatabase> {
  return indexDatabaseKnowledge(id);
}

export async function activateDatabase(id: string): Promise<UserDatabase> {
  const data = await request<{ database: UserDatabase }>(
    `/api/databases/${id}/activate`,
    { method: "POST" },
  );
  return data.database;
}

export async function deleteDatabase(id: string): Promise<void> {
  await request(`/api/databases/${id}`, { method: "DELETE" });
}

export async function testDatabaseConnection(
  dbType: "postgres" | "mysql",
  dbUri: string,
): Promise<void> {
  await request("/api/databases/test", {
    method: "POST",
    body: JSON.stringify({ dbType, dbUri }),
  });
}

export interface DatabaseSchemaResponse {
  dbMetadata: unknown;
  schemaTableCount?: number;
  schemaSyncStatus?: SchemaSyncStatus;
  schemaSyncedAt?: string | null;
  schemaSyncError?: string | null;
}

export async function previewDatabaseSchema(
  dbType: "postgres" | "mysql",
  dbUri: string,
): Promise<{ dbMetadata: unknown; schemaTableCount: number }> {
  return request("/api/databases/preview-schema", {
    method: "POST",
    body: JSON.stringify({ dbType, dbUri }),
  });
}

export async function fetchDatabaseSchema(
  id: string,
): Promise<DatabaseSchemaResponse> {
  return request(`/api/databases/${id}/schema`);
}

export interface ManagedUser extends User {
  _count: { conversations: number; databases: number };
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = await request<{ users: ManagedUser[] }>("/api/users");
  return data.users;
}

export async function createUser(
  username: string,
  password: string,
): Promise<User> {
  const data = await request<{ user: User }>("/api/users", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.user;
}

export async function deleteUser(id: string): Promise<void> {
  await request(`/api/users/${id}`, { method: "DELETE" });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request("/api/users/me/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onAgentEvent?: (event: AgentEvent) => void;
  onDone: (meta: {
    requestId?: string;
    correlationId?: string;
    generatedSql?: string;
    validationPassed?: boolean;
    debug?: Record<string, unknown>;
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalTokens?: number;
  }) => void;
  onError: (message: string) => void;
  onStatus?: (meta: { message: string; requestId?: string }) => void;
}

export interface SendMessageOptions {
  debug?: boolean;
}

export async function sendMessage(
  conversationId: string,
  query: string,
  dryRun: boolean,
  handlers: StreamHandlers,
  options?: SendMessageOptions,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      query,
      dryRun,
      streamEvents: true,
      debug: options?.debug ?? false,
    }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  if (!res.body) throw new Error("No response body for stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortReader = () => {
    void reader.cancel().catch(() => undefined);
  };

  if (signal?.aborted) {
    abortReader();
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const onAbort = () => abortReader();
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let data = "";

        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }

        if (!data) continue;
        if (event === "ping") continue;

        const payload = JSON.parse(data);
        if (event === "status") handlers.onStatus?.(payload);
        if (event === "agent" && isAgentEvent(payload)) {
          if (
            isPublicStreamEvent(payload, options?.debug ?? false)
          ) {
            handlers.onAgentEvent?.(payload);
          }
          if (payload.type === "token") {
            handlers.onToken(payload.content);
          }
          if (payload.type === "error") {
            handlers.onError(payload.message ?? "Unknown error");
          }
        }
        if (event === "token") handlers.onToken(payload.text ?? "");
        if (event === "done") handlers.onDone(payload);
        if (event === "error")
          handlers.onError(payload.message ?? "Unknown error");
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    abortReader();
  }
}

export type WorkflowRunStatus = "pass" | "fail" | "error" | "planner_skip";

export type FailurePhase =
  | "query_build"
  | "execution"
  | "verification"
  | "planner"
  | "agent_error"
  | "none";

export interface FailedNodeResponse {
  node: string;
  label: string;
  text?: string;
  state: Record<string, unknown>;
}

export interface LlmCallUsage {
  node?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface QueryAttempt {
  attemptNumber: number;
  kind: "initial" | "rerun";
  ranAt: string;
  status: WorkflowRunStatus;
  durationMs: number;
  requestId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCalls: LlmCallUsage[];
  failurePhase: FailurePhase;
  failedNode?: string;
  failureState?: Record<string, unknown>;
  failedNodeResponse?: FailedNodeResponse;
  generatedSql?: string | null;
  markdownPreview?: string;
  markdownResponse?: string;
  workflowPath?: string[];
  workflowStatus?: string;
  errorMessage?: string;
}

export interface QueryRunResult {
  groupName: string;
  query: string;
  status: WorkflowRunStatus;
  failurePhase: FailurePhase;
  failedNode?: string;
  failureState?: Record<string, unknown>;
  failedNodeResponse?: FailedNodeResponse;
  generatedSql?: string | null;
  markdownPreview?: string;
  markdownResponse?: string;
  durationMs: number;
  workflowPath?: string[];
  workflowStatus?: string;
  requestId?: string;
  errorMessage?: string;
  queryKey?: string;
  attempts?: QueryAttempt[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  executionCount?: number;
}

export type WorkflowTestRunLifecycleStatus =
  | "running"
  | "completed"
  | "partial"
  | "cancelled";

export interface PlannedQueryItem {
  groupName: string;
  query: string;
}

export interface WorkflowTestSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  plannerSkipped: number;
  byPhase: Partial<Record<FailurePhase, number>>;
  byGroup: Record<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      errors: number;
      plannerSkipped: number;
    }
  >;
  executionCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  llmCallCount?: number;
  runStatus?: WorkflowTestRunLifecycleStatus;
  plannedQueries?: number;
  plannedItems?: PlannedQueryItem[];
}

export interface WorkflowTestCompletePayload {
  testId?: string;
  runId?: string;
  testName: string;
  dryRun: boolean;
  delayMs?: number;
  database: { dbType: string; name: string; host: string };
  ranAt: string;
  agent?: AgentSummary;
  summary: WorkflowTestSummary;
  results: QueryRunResult[];
}

export type WorkflowTestGroupKind = "manual" | "failures";

export interface WorkflowTestGroupRecord {
  id: string;
  name: string;
  kind: WorkflowTestGroupKind;
  sortOrder: number;
  queries: string[];
}

export interface SavedWorkflowTest {
  id: string;
  name: string;
  agentProfileId: string | null;
  suiteKey: string | null;
  agent: AgentSummary | null;
  dryRun: boolean;
  delayMs: number;
  groups: WorkflowTestGroupRecord[];
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRun: {
    id: string;
    ranAt: string;
    summary: WorkflowTestSummary;
  } | null;
}

export interface WorkflowTestDetail extends SavedWorkflowTest {
  runs: Array<{
    id: string;
    ranAt: string;
    dryRun: boolean;
    summary: WorkflowTestSummary;
  }>;
}

export function isResumableWorkflowRun(
  report: WorkflowTestCompletePayload,
): boolean {
  const planned = report.summary.plannedQueries ?? 0;
  const completed = report.results.length;
  if (!report.runId || planned <= 0 || completed >= planned) return false;
  const status = report.summary.runStatus;
  return (
    status === "running" ||
    status === "partial" ||
    status === "cancelled"
  );
}

export interface WorkflowTestHandlers {
  onStart?: (meta: {
    testName: string;
    testId?: string;
    totalQueries: number;
    overallTotalQueries?: number;
    completedQueries?: number;
    dryRun: boolean;
    runId?: string;
    resume?: boolean;
    rerun?: boolean;
  }) => void;
  onProgress?: (meta: {
    groupName: string;
    queryIndex: number;
    totalQueries: number;
    query: string;
  }) => void;
  onStatus?: (meta: { message: string }) => void;
  onResult?: (result: QueryRunResult) => void;
  onComplete?: (payload: WorkflowTestCompletePayload) => void;
  onError?: (message: string) => void;
}

async function consumeWorkflowTestStream(
  res: Response,
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error("No response body for stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortReader = () => {
    void reader.cancel().catch(() => undefined);
  };

  if (signal?.aborted) {
    abortReader();
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const onAbort = () => abortReader();
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let data = "";

        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }

        if (!data) continue;
        if (event === "ping") continue;

        const payload = JSON.parse(data);
        if (event === "start") handlers.onStart?.(payload);
        if (event === "progress") handlers.onProgress?.(payload);
        if (event === "status") handlers.onStatus?.(payload);
        if (event === "result") handlers.onResult?.(payload as QueryRunResult);
        if (event === "complete") {
          handlers.onComplete?.(payload as WorkflowTestCompletePayload);
        }
        if (event === "error") {
          handlers.onError?.(payload.message ?? "Unknown error");
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    abortReader();
  }
}

export async function runWorkflowTest(
  input: {
    testName: string;
    groups?: Array<{ name: string; queries: string[] }>;
    groupIds?: string[];
    agentProfileId?: string | null;
    dryRun?: boolean;
    delayMs?: number;
  },
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/workflow-test/run", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  await consumeWorkflowTestStream(res, handlers, signal);
}

export async function runWorkflowTestGroup(
  testId: string,
  groupId: string,
  input: { dryRun?: boolean; delayMs?: number } | undefined,
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/workflow-test/${testId}/groups/${groupId}/run`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input ?? {}),
      signal,
    },
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  await consumeWorkflowTestStream(res, handlers, signal);
}

export async function importWorkflowTestFailures(
  testId: string,
  runId: string,
): Promise<{
  groups: WorkflowTestGroupRecord[];
  added: number;
  skipped: number;
}> {
  return request(`/api/workflow-test/${testId}/groups/failures/import`, {
    method: "POST",
    body: JSON.stringify({ runId }),
  });
}

export async function listWorkflowTests(): Promise<SavedWorkflowTest[]> {
  const data = await request<{ tests: SavedWorkflowTest[] }>("/api/workflow-test");
  return data.tests;
}

export async function getWorkflowTest(testId: string): Promise<WorkflowTestDetail> {
  const data = await request<{ test: WorkflowTestDetail }>(
    `/api/workflow-test/${testId}`,
  );
  return data.test;
}

export async function getWorkflowTestRun(
  runId: string,
): Promise<WorkflowTestCompletePayload> {
  const data = await request<{ report: WorkflowTestCompletePayload }>(
    `/api/workflow-test/runs/${runId}`,
  );
  return data.report;
}

export async function deleteWorkflowTest(testId: string): Promise<void> {
  await request(`/api/workflow-test/${testId}`, { method: "DELETE" });
}

export async function duplicateWorkflowTest(
  testId: string,
  input: { agentProfileId: string; testName?: string },
): Promise<{
  test: {
    id: string;
    name: string;
    agentProfileId: string;
    suiteKey: string;
    dryRun: boolean;
    delayMs: number;
  };
  groups: WorkflowTestGroupRecord[];
}> {
  return request(`/api/workflow-test/${testId}/duplicate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function rerunWorkflowTestFailures(
  runId: string,
  input: { dryRun?: boolean; delayMs?: number } | undefined,
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/workflow-test/runs/${runId}/rerun-failures`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input ?? {}),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  await consumeWorkflowTestStream(res, handlers, signal);
}

export async function resumeWorkflowTestRun(
  runId: string,
  input: { dryRun?: boolean; delayMs?: number } | undefined,
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/workflow-test/runs/${runId}/resume`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input ?? {}),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  await consumeWorkflowTestStream(res, handlers, signal);
}

export interface ActiveWorkflowTestRun {
  id: string;
  testName: string;
  testId: string;
  summary: WorkflowTestSummary;
  resultCount: number;
}

export async function getActiveWorkflowTestRun(): Promise<{
  run: ActiveWorkflowTestRun | null;
}> {
  return request<{ run: ActiveWorkflowTestRun | null }>(
    "/api/workflow-test/runs/active",
  );
}

export async function cancelWorkflowTestRun(runId: string): Promise<void> {
  await request(`/api/workflow-test/runs/${runId}/cancel`, { method: "POST" });
}

export async function watchWorkflowTestRun(
  runId: string,
  handlers: WorkflowTestHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/workflow-test/runs/${runId}/watch`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/event-stream" },
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  await consumeWorkflowTestStream(res, handlers, signal);
}

export interface UsageTotals {
  executionCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

export interface RecentExecutionRow {
  id: string;
  source: "workflow_test" | "chat";
  query: string;
  groupName: string | null;
  status: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCallCount: number;
  durationMs: number;
  attemptNumber: number;
  ranAt: string;
  workflowTestRunId: string | null;
  messageId: string | null;
}

export interface PlatformUsageResponse {
  totals: UsageTotals;
  bySource: {
    workflow_test: UsageTotals;
    chat: UsageTotals;
  };
  recentExecutions: RecentExecutionRow[];
}

export async function getPlatformUsage(params?: {
  from?: string;
  to?: string;
}): Promise<PlatformUsageResponse> {
  const search = new URLSearchParams();
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  const query = search.toString();
  return request(`/api/observability/usage${query ? `?${query}` : ""}`);
}
