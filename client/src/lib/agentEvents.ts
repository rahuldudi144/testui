/** Mirrors DB-Agent stream event types for the testui client. */
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

export type AgentStreamEvent =
  | { type: "status"; message: string }
  | { type: "node_start"; node: GraphNodeName }
  | { type: "node_complete"; node: GraphNodeName; durationMs: number }
  | { type: "sql_generated"; sql: string }
  | { type: "validation_failed"; errors: string[] }
  | { type: "query_executed"; rowCount: number }
  | { type: "token"; content: string }
  | { type: "debug"; name: string; data: unknown }
  | { type: "error"; message: string; code?: string }
  | { type: "done" };

export type CompletedNode = {
  node: GraphNodeName;
  durationMs: number;
};

export type AgentProgress = {
  activeNode: GraphNodeName | null;
  completedNodes: CompletedNode[];
  statusMessage: string | null;
  validationErrors: string[] | null;
  rowCount: number | null;
};

export const INITIAL_AGENT_PROGRESS: AgentProgress = {
  activeNode: null,
  completedNodes: [],
  statusMessage: null,
  validationErrors: null,
  rowCount: null,
};

export function reduceAgentEvent(
  state: AgentProgress,
  event: AgentStreamEvent,
): AgentProgress {
  switch (event.type) {
    case "node_start":
      return {
        ...state,
        activeNode: event.node,
        validationErrors:
          event.node === "buildQuery" ||
          event.node === "validateQuery" ||
          event.node === "repairQuery"
            ? null
            : state.validationErrors,
      };
    case "node_complete":
      return {
        ...state,
        activeNode: null,
        completedNodes: [
          ...state.completedNodes,
          { node: event.node, durationMs: event.durationMs },
        ],
      };
    case "status":
      return { ...state, statusMessage: event.message };
    case "validation_failed":
      return { ...state, validationErrors: event.errors };
    case "query_executed":
      return { ...state, rowCount: event.rowCount };
    default:
      return state;
  }
}

/** Labels aligned with DB-Agent streaming/streamEvents.config.ts */
const NODE_LABELS: Record<GraphNodeName, string> = {
  planner: "Planning",
  knowledgeLoader: "Loading knowledge",
  entityExtractor: "Extracting business concepts",
  semanticSearch: "Semantic search",
  pathFinder: "Finding join paths",
  knowledgeExpansion: "Expanding knowledge",
  operationPlanner: "Planning operations",
  buildQuery: "Generating SQL",
  validateQuery: "Validating SQL",
  runQuery: "Executing query",
  repairQuery: "Repairing SQL",
  formatResponse: "Formatting response",
  answer: "Answering",
};

export function nodeLabel(node: GraphNodeName): string {
  return NODE_LABELS[node] ?? node;
}
