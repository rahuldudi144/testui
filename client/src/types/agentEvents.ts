export type GraphNodeName =
  | "planner"
  | "knowledgeLoader"
  | "entityExtractor"
  | "semanticSearch"
  | "pathFinder"
  | "knowledgeExpansion"
  | "operationPlanner"
  | "buildQuery"
  | "validateQuery"
  | "runQuery"
  | "repairQuery"
  | "formatResponse"
  | "answer";

export type NodeStartEvent = {
  type: "node_start";
  node: GraphNodeName;
};

export type NodeCompleteEvent = {
  type: "node_complete";
  node: GraphNodeName;
  durationMs: number;
};

export type SqlGeneratedEvent = {
  type: "sql_generated";
  sql: string;
};

export type ValidationFailedEvent = {
  type: "validation_failed";
  errors: string[];
};

export type QueryExecutedEvent = {
  type: "query_executed";
  rowCount: number;
};

export type TokenEvent = {
  type: "token";
  content: string;
};

export type LlmUsageEvent = {
  type: "llm_usage";
  node: GraphNodeName;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type DoneEvent = {
  type: "done";
  stateHistory?: unknown[];
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalTokens?: number;
};

export type ErrorEvent = {
  type: "error";
  message: string;
  code?: string;
};

export type StatusEvent = {
  type: "status";
  message: string;
};

export type DebugEvent = {
  type: "debug";
  name: string;
  data: unknown;
};

export type KnowledgeProgressEvent = {
  type: "knowledge_progress";
  table: string;
  completed: number;
  total: number;
};

export type KnowledgeCompletedEvent = {
  type: "knowledge_completed";
};

export type KnowledgeFailedEvent = {
  type: "knowledge_failed";
  table: string;
  error: string;
};

export type AgentEvent =
  | StatusEvent
  | NodeStartEvent
  | NodeCompleteEvent
  | SqlGeneratedEvent
  | ValidationFailedEvent
  | QueryExecutedEvent
  | LlmUsageEvent
  | TokenEvent
  | DebugEvent
  | ErrorEvent
  | DoneEvent
  | KnowledgeProgressEvent
  | KnowledgeCompletedEvent
  | KnowledgeFailedEvent;

export function isAgentEvent(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof (value as AgentEvent).type === "string"
  );
}
