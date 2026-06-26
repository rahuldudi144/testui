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
  businessContext: string | null;
  schemaSyncStatus: SchemaSyncStatus;
  schemaSyncedAt: string | null;
  schemaSyncError: string | null;
  schemaTableCount: number;
  hasBusinessContext: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LlmProvider = "openai" | "ollama";

export interface UserAgent {
  id: string;
  name: string;
  systemPrompt: string | null;
  hasSystemPrompt: boolean;
  llmProvider: LlmProvider | null;
  modelName: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLlmInput {
  llmProvider?: LlmProvider | null;
  modelName?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
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
  } & AgentLlmInput,
): Promise<UserAgent> {
  const data = await request<{ agent: UserAgent }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.agent;
}

export async function updateAgentProfile(
  id: string,
  input: { name?: string; systemPrompt?: string } & AgentLlmInput,
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
  businessContext?: string;
  setActive?: boolean;
  fetchSchema?: boolean;
  dbMetadata?: unknown;
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

export async function syncDatabaseSchema(id: string): Promise<UserDatabase> {
  const data = await request<{ database: UserDatabase }>(
    `/api/databases/${id}/sync-schema`,
    { method: "POST" },
  );
  return data.database;
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
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  if (!res.body) throw new Error("No response body for stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
}

export interface WorkflowTestCompletePayload {
  testId?: string;
  runId?: string;
  testName: string;
  dryRun: boolean;
  delayMs?: number;
  database: { dbType: string; name: string; host: string };
  ranAt: string;
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

export interface WorkflowTestHandlers {
  onStart?: (meta: {
    testName: string;
    testId?: string;
    totalQueries: number;
    dryRun: boolean;
  }) => void;
  onProgress?: (meta: {
    groupName: string;
    queryIndex: number;
    totalQueries: number;
    query: string;
  }) => void;
  onResult?: (result: QueryRunResult) => void;
  onComplete?: (payload: WorkflowTestCompletePayload) => void;
  onError?: (message: string) => void;
}

async function consumeWorkflowTestStream(
  res: Response,
  handlers: WorkflowTestHandlers,
): Promise<void> {
  if (!res.body) throw new Error("No response body for stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
      if (event === "result") handlers.onResult?.(payload as QueryRunResult);
      if (event === "complete") {
        handlers.onComplete?.(payload as WorkflowTestCompletePayload);
      }
      if (event === "error") {
        handlers.onError?.(payload.message ?? "Unknown error");
      }
    }
  }
}

export async function runWorkflowTest(
  input: {
    testName: string;
    groups?: Array<{ name: string; queries: string[] }>;
    groupIds?: string[];
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

  await consumeWorkflowTestStream(res, handlers);
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

  await consumeWorkflowTestStream(res, handlers);
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
