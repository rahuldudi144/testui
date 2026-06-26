import type { Message } from "../../types/index.js";
import type { StateHistoryEntry } from "../../schemas/state.js";

export interface ParsedRunMetrics {
  planner?: {
    isDomainSpecific: boolean;
    requiresSql: boolean;
    reason: string;
  };
  validationAttempts: Array<{
    attempt: number;
    validationPassed: boolean;
    source?: string;
    errorCount?: number;
  }>;
  verificationAttempts: Array<{
    attempt: number;
    answerSatisfied: boolean;
    reason?: string;
  }>;
  llmCalls: Array<{
    event: string;
    node?: string;
    latencyMs?: number;
    success?: boolean;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }>;
  dbOperations: Array<{
    event: string;
    durationMs?: number;
    success?: boolean;
    tableCount?: number;
    rowCount?: number;
  }>;
  nodeTimeline: Array<{
    node: string;
    event: string;
    durationMs?: number;
    success?: boolean;
  }>;
  stateTransitions: Array<{
    node: string;
    changed: string[];
  }>;
  totals: {
    llmCallCount: number;
    structuredLlmCallCount: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalLlmLatencyMs: number;
    validationFailureCount: number;
    dbConnectMs?: number;
    schemaFetchMs?: number;
    queryExecutionMs?: number;
    tablesInSchema?: number;
    rowsReturned?: number;
  };
}

const PLANNER_RE =
  /isDomainSpecific=(true|false),\s*requiresSql=(true|false)\s*\((.+)\)/;

const LEGACY_PLANNER_RE =
  /requiresSql=(true|false)\s*\((.+)\)/;

export interface SqlParserStatsSummary {
  dialect: string;
  statementType: string;
  tableCount: number;
  columnCount: number;
  tables: string[];
}

function isSqlParserStats(value: unknown): value is SqlParserStatsSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.dialect === "string" &&
    typeof record.statementType === "string" &&
    typeof record.tableCount === "number" &&
    typeof record.columnCount === "number" &&
    Array.isArray(record.tables)
  );
}

function extractSqlParserFromHistory(stateHistory?: StateHistoryEntry[]): {
  sqlParserPassed?: boolean;
  sqlParserError?: string;
  sqlParserStats?: SqlParserStatsSummary;
} {
  if (!stateHistory?.length) return {};

  const validateEntries = stateHistory.filter(
    (e) => normalizeNodeId(e.node) === "validateQuery",
  );
  const last = validateEntries.at(-1);
  if (!last) return {};

  const { changes } = last;
  return {
    sqlParserPassed:
      typeof changes.sqlParserPassed === "boolean"
        ? changes.sqlParserPassed
        : undefined,
    sqlParserError:
      typeof changes.sqlParserError === "string" && changes.sqlParserError.length > 0
        ? changes.sqlParserError
        : undefined,
    sqlParserStats: isSqlParserStats(changes.sqlParserStats)
      ? changes.sqlParserStats
      : undefined,
  };
}

function inferSqlParserFromMetrics(metrics: ParsedRunMetrics): {
  sqlParserPassed?: boolean;
  sqlParserError?: string;
} {
  const parserAttempts = metrics.validationAttempts.filter(
    (v) => v.source === "sql_parser",
  );
  if (parserAttempts.length === 0) return {};

  const last = parserAttempts.at(-1);
  if (!last) return {};

  if (!last.validationPassed) {
    return { sqlParserPassed: false };
  }
  return { sqlParserPassed: true };
}

function normalizeNodeId(node: string): string {
  return node === "getSchema" ? "schemaResolver" : node;
}

export function parseMetricsFromLogs(
  logs: Record<string, unknown>[],
): ParsedRunMetrics {
  const validationAttempts: ParsedRunMetrics["validationAttempts"] = [];
  const verificationAttempts: ParsedRunMetrics["verificationAttempts"] = [];
  const llmCalls: ParsedRunMetrics["llmCalls"] = [];
  const dbOperations: ParsedRunMetrics["dbOperations"] = [];
  const nodeTimeline: ParsedRunMetrics["nodeTimeline"] = [];
  const stateTransitions: ParsedRunMetrics["stateTransitions"] = [];
  let planner: ParsedRunMetrics["planner"];

  for (const log of logs) {
    const event = typeof log.event === "string" ? log.event : undefined;
    const message = typeof log.message === "string" ? log.message : undefined;
    const node = typeof log.node === "string" ? log.node : undefined;

    if (message?.includes("planner: decision")) {
      const match = message.match(PLANNER_RE) ?? message.match(LEGACY_PLANNER_RE);
      if (match) {
        if (match.length === 4) {
          planner = {
            isDomainSpecific: match[1] === "true",
            requiresSql: match[2] === "true",
            reason: match[3],
          };
        } else {
          planner = {
            isDomainSpecific: true,
            requiresSql: match[1] === "true",
            reason: match[2],
          };
        }
      }
    }

    if (event === "validation_attempt") {
      validationAttempts.push({
        attempt: Number(log.attempt ?? 0),
        validationPassed: Boolean(log.validationPassed),
        source: typeof log.source === "string" ? log.source : undefined,
        errorCount: typeof log.errorCount === "number" ? log.errorCount : undefined,
      });
    }

    if (event === "verification_attempt") {
      verificationAttempts.push({
        attempt: Number(log.attempt ?? 0),
        answerSatisfied: Boolean(log.answerSatisfied),
        reason: typeof log.reason === "string" ? log.reason : undefined,
      });
    }

    if (event === "llm_call" || event === "llm_structured_call") {
      llmCalls.push({
        event,
        node,
        latencyMs: typeof log.latencyMs === "number" ? log.latencyMs : undefined,
        success: typeof log.success === "boolean" ? log.success : undefined,
        promptTokens:
          typeof log.promptTokens === "number" ? log.promptTokens : undefined,
        completionTokens:
          typeof log.completionTokens === "number" ? log.completionTokens : undefined,
        totalTokens:
          typeof log.totalTokens === "number" ? log.totalTokens : undefined,
      });
    }

    if (
      event === "db_connect" ||
      event === "db_close" ||
      event === "db_fetch_schema" ||
      event === "db_run_query"
    ) {
      dbOperations.push({
        event,
        durationMs: typeof log.durationMs === "number" ? log.durationMs : undefined,
        success: typeof log.success === "boolean" ? log.success : undefined,
        tableCount:
          typeof log.tableCount === "number" ? log.tableCount : undefined,
        rowCount: typeof log.rowCount === "number" ? log.rowCount : undefined,
      });
    }

    if (
      event === "node_start" ||
      event === "node_end" ||
      event === "node_error"
    ) {
      if (node) {
        nodeTimeline.push({
          node: normalizeNodeId(node),
          event,
          durationMs:
            typeof log.durationMs === "number" ? log.durationMs : undefined,
          success: typeof log.success === "boolean" ? log.success : undefined,
        });
      }
    }

    if (event === "state_transition" && node && Array.isArray(log.changed)) {
      stateTransitions.push({
        node: normalizeNodeId(node),
        changed: log.changed.filter((k): k is string => typeof k === "string"),
      });
    }
  }

  if (stateTransitions.length === 0) {
    for (const entry of nodeTimeline) {
      if (entry.event === "node_end") {
        stateTransitions.push({ node: entry.node, changed: [] });
      }
    }
  }

  if (stateTransitions.length === 0) {
    for (const entry of nodeTimeline) {
      if (entry.event === "node_end") {
        stateTransitions.push({ node: entry.node, changed: [] });
      }
    }
  }

  const tokenCalls = llmCalls.filter((c) => c.event === "llm_call");
  const structuredCalls = llmCalls.filter((c) => c.event === "llm_structured_call");

  const dbConnect = dbOperations.find((d) => d.event === "db_connect");
  const schemaFetch = dbOperations.find((d) => d.event === "db_fetch_schema");
  const queryRun = dbOperations.find((d) => d.event === "db_run_query");

  return {
    planner,
    validationAttempts,
    verificationAttempts,
    llmCalls,
    dbOperations,
    nodeTimeline,
    stateTransitions,
    totals: {
      llmCallCount: tokenCalls.length,
      structuredLlmCallCount: structuredCalls.length,
      totalPromptTokens: tokenCalls.reduce((n, c) => n + (c.promptTokens ?? 0), 0),
      totalCompletionTokens: tokenCalls.reduce(
        (n, c) => n + (c.completionTokens ?? 0),
        0,
      ),
      totalLlmLatencyMs: llmCalls.reduce((n, c) => n + (c.latencyMs ?? 0), 0),
      validationFailureCount: validationAttempts.filter((v) => !v.validationPassed)
        .length,
      dbConnectMs: dbConnect?.durationMs,
      schemaFetchMs: schemaFetch?.durationMs,
      queryExecutionMs: queryRun?.durationMs,
      tablesInSchema: schemaFetch?.tableCount,
      rowsReturned: queryRun?.rowCount,
    },
  };
}

export interface AgentRunContext {
  agent: {
    provider: string;
    model: string;
    readOnly: boolean;
    maxValidationRetries: number;
  };
  input: {
    query: string;
    dryRun: boolean;
    priorMessageCount: number;
    messages: Message[];
  };
  output?: {
    markdownResponse: string;
    generatedSql?: string | null;
    validationPassed?: boolean;
    validationErrors?: string[];
    executionResult?: {
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
    };
  };
}

export function summarizeWorkflowStatus(
  metrics: ParsedRunMetrics,
  trace: Record<string, unknown> | undefined,
  output?: AgentRunContext["output"],
  stateHistory?: StateHistoryEntry[],
): {
  status: "success" | "failed" | "partial";
  isDomainSpecific?: boolean;
  requiresSql?: boolean;
  plannerReason?: string;
  validationPassed?: boolean;
  answerSatisfied?: boolean;
  sqlParserPassed?: boolean;
  sqlParserError?: string;
  sqlParserStats?: SqlParserStatsSummary;
  nodesExecuted: string[];
} {
  const nodesExecuted = [
    ...new Set(
      metrics.nodeTimeline
        .filter((n) => n.event === "node_end" && n.success)
        .map((n) => n.node),
    ),
  ];

  const traceSuccess = trace?.success;
  const validationPassed =
    output?.validationPassed ??
    (metrics.validationAttempts.length > 0
      ? metrics.validationAttempts.at(-1)?.validationPassed
      : undefined);

  const answerSatisfied =
    metrics.verificationAttempts.length > 0
      ? metrics.verificationAttempts.at(-1)?.answerSatisfied
      : undefined;

  let status: "success" | "failed" | "partial" = "success";
  if (traceSuccess === false) status = "failed";
  else if (validationPassed === false || answerSatisfied === false) status = "partial";

  const fromHistory = extractSqlParserFromHistory(stateHistory);
  const fromMetrics = inferSqlParserFromMetrics(metrics);

  return {
    status,
    isDomainSpecific: metrics.planner?.isDomainSpecific,
    requiresSql: metrics.planner?.requiresSql,
    plannerReason: metrics.planner?.reason,
    validationPassed,
    answerSatisfied,
    sqlParserPassed: fromHistory.sqlParserPassed ?? fromMetrics.sqlParserPassed,
    sqlParserError: fromHistory.sqlParserError,
    sqlParserStats: fromHistory.sqlParserStats,
    nodesExecuted,
  };
}

export type NodeRunStatus = "success" | "failed" | "skipped" | "pending";

export interface WorkflowGraphNode {
  id: string;
  label: string;
  status: NodeRunStatus;
  order?: number;
  durationMs?: number;
  stateChanges: string[];
  state: Record<string, unknown>;
  runCount?: number;
  visits?: Array<{ step: number; changes: Record<string, unknown> }>;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  label?: string;
  taken: boolean;
}

export interface WorkflowGraph {
  path: string[];
  pathSteps?: Array<{ step: number; node: string }>;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

const ALL_NODES = [
  { id: "planner", label: "Planner" },
  { id: "answer", label: "Answer" },
  { id: "schemaResolver", label: "Schema resolver" },
  { id: "graphBuilder", label: "Relationship graph" },
  { id: "entityExtractor", label: "Entity extractor" },
  { id: "pathFinder", label: "Path finder" },
  { id: "operationPlanner", label: "Operation planner" },
  { id: "buildQuery", label: "Build query" },
  { id: "validateQuery", label: "Validate query" },
  { id: "runQuery", label: "Run query" },
  { id: "repairQuery", label: "Repair query" },
  { id: "formatResponse", label: "Format response" },
] as const;

const GRAPH_EDGES: Array<{ from: string; to: string; label?: string }> = [
  { from: "planner", to: "answer", label: "non-SQL / off-domain" },
  { from: "planner", to: "schemaResolver", label: "domain + SQL" },
  { from: "schemaResolver", to: "graphBuilder" },
  { from: "graphBuilder", to: "entityExtractor" },
  { from: "entityExtractor", to: "pathFinder" },
  { from: "pathFinder", to: "operationPlanner" },
  { from: "operationPlanner", to: "buildQuery" },
  { from: "buildQuery", to: "validateQuery" },
  { from: "validateQuery", to: "runQuery", label: "valid" },
  { from: "validateQuery", to: "formatResponse", label: "dry run" },
  { from: "validateQuery", to: "buildQuery", label: "validation retry" },
  { from: "validateQuery", to: "answer", label: "validation exhausted" },
  { from: "runQuery", to: "formatResponse", label: "success" },
  { from: "runQuery", to: "repairQuery", label: "execution retry" },
  { from: "runQuery", to: "answer", label: "execution exhausted" },
  { from: "repairQuery", to: "validateQuery", label: "re-validate" },
];

function spanMap(
  trace: Record<string, unknown> | undefined,
): Map<string, { durationMs: number; success: boolean }> {
  const map = new Map<string, { durationMs: number; success: boolean }>();
  if (!trace || !Array.isArray(trace.spans)) return map;

  for (const span of trace.spans as Array<Record<string, unknown>>) {
    const name = typeof span.nodeName === "string" ? span.nodeName : undefined;
    if (!name) continue;
    const normalized = normalizeNodeId(name);
    map.set(normalized, {
      durationMs: typeof span.durationMs === "number" ? span.durationMs : 0,
      success: span.success !== false,
    });
  }
  return map;
}

function executionPath(
  metrics: ParsedRunMetrics,
  trace: Record<string, unknown> | undefined,
): string[] {
  const fromTimeline = metrics.nodeTimeline
    .filter((e) => e.event === "node_end")
    .map((e) => normalizeNodeId(e.node));

  if (fromTimeline.length > 0) return fromTimeline;

  if (trace && Array.isArray(trace.spans)) {
    return (trace.spans as Array<Record<string, unknown>>)
      .map((s) =>
        typeof s.nodeName === "string" ? normalizeNodeId(s.nodeName) : null,
      )
      .filter((n): n is string => Boolean(n));
  }

  return [];
}

function resolveNodeState(
  nodeId: string,
  changed: string[],
  context: {
    workflow: ReturnType<typeof summarizeWorkflowStatus>;
    output?: AgentRunContext["output"];
    input?: { dryRun?: boolean };
    metrics: ParsedRunMetrics;
  },
): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const { workflow, output, input, metrics } = context;

  for (const key of changed) {
    switch (key) {
      case "requiresSql":
        if (workflow.requiresSql !== undefined) state.requiresSql = workflow.requiresSql;
        break;
      case "isDomainSpecific":
        if (workflow.isDomainSpecific !== undefined) {
          state.isDomainSpecific = workflow.isDomainSpecific;
        }
        break;
      case "userIntent":
      case "requiredData":
      case "maxRetries":
      case "maxAnswerRetries":
      case "answerRetryCount":
        break;
      case "executionSucceeded":
      case "executionError":
      case "answerVerificationReason":
        break;
      case "answerSatisfied":
        if (workflow.answerSatisfied !== undefined) {
          state.answerSatisfied = workflow.answerSatisfied;
        }
        break;
      case "verificationReason":
        break;
      case "plannerReason":
        if (workflow.plannerReason) state.plannerReason = workflow.plannerReason;
        break;
      case "generatedSql":
        if (output?.generatedSql) state.generatedSql = output.generatedSql;
        break;
      case "validationPassed":
        if (workflow.validationPassed !== undefined) {
          state.validationPassed = workflow.validationPassed;
        }
        break;
      case "validationErrors":
        if (output?.validationErrors?.length) {
          state.validationErrors = output.validationErrors;
        }
        break;
      case "sqlParserPassed":
        break;
      case "sqlParserError":
        break;
      case "sqlParserStats":
        break;
      case "retryCount": {
        const failures = metrics.validationAttempts.filter((v) => !v.validationPassed).length;
        if (failures > 0) state.retryCount = failures;
        break;
      }
      case "dbMetadata":
        if (metrics.totals.tablesInSchema !== undefined) {
          state.tablesInSchema = metrics.totals.tablesInSchema;
        }
        break;
      case "executionResult":
        if (output?.executionResult) {
          state.rowCount = output.executionResult.rowCount;
          state.columns = output.executionResult.columns;
        } else if (metrics.totals.rowsReturned !== undefined) {
          state.rowCount = metrics.totals.rowsReturned;
        }
        break;
      case "markdownResponse":
        if (output?.markdownResponse) {
          state.preview = output.markdownResponse.slice(0, 120);
        }
        break;
      case "dryRun":
        if (input?.dryRun !== undefined) state.dryRun = input.dryRun;
        break;
      default:
        break;
    }
  }

  if (nodeId === "planner") {
    if (workflow.isDomainSpecific !== undefined) {
      state.isDomainSpecific = workflow.isDomainSpecific;
    }
    if (workflow.requiresSql !== undefined) state.requiresSql = workflow.requiresSql;
    if (workflow.plannerReason) state.plannerReason = workflow.plannerReason;
  }
  if (nodeId === "buildQuery" && output?.generatedSql) {
    state.generatedSql = output.generatedSql;
  }
  if (nodeId === "validateQuery") {
    if (workflow.validationPassed !== undefined) {
      state.validationPassed = workflow.validationPassed;
    }
    if (workflow.sqlParserPassed !== undefined) {
      state.sqlParserPassed = workflow.sqlParserPassed;
    }
    if (workflow.sqlParserError) {
      state.sqlParserError = workflow.sqlParserError;
    }
    if (workflow.sqlParserStats) {
      state.sqlParserStats = workflow.sqlParserStats;
    }
    if (metrics.validationAttempts.length > 0) {
      state.attempts = metrics.validationAttempts.length;
      const sources = [...new Set(metrics.validationAttempts.map((v) => v.source).filter(Boolean))];
      if (sources.length > 0) state.validationSources = sources;
    }
  }
  if (nodeId === "runQuery" && metrics.totals.rowsReturned !== undefined) {
    state.rowCount = metrics.totals.rowsReturned;
  }
  if (nodeId === "schemaResolver" && metrics.totals.tablesInSchema !== undefined) {
    state.tablesInSchema = metrics.totals.tablesInSchema;
  }

  return state;
}

function nodeStatusFromHistory(
  nodeId: string,
  visits: StateHistoryEntry[],
  span: { durationMs: number; success: boolean } | undefined,
  failedEnd: boolean,
): NodeRunStatus {
  if (visits.length === 0) return "skipped";

  const last = visits.at(-1);
  const changes = last?.changes ?? {};

  if (failedEnd || (span && !span.success)) return "failed";
  if (nodeId === "runQuery") {
    if (changes.executionSucceeded === false) return "failed";
    if (
      typeof changes.executionError === "string" &&
      changes.executionError.length > 0
    ) {
      return "failed";
    }
  }
  if (nodeId === "validateQuery" && changes.validationPassed === false) {
    return "failed";
  }
  if (nodeId === "validateQuery" && changes.sqlParserPassed === false) {
    return "failed";
  }

  return "success";
}

function buildVisitsByNode(
  stateHistory: StateHistoryEntry[],
): Map<string, Array<{ step: number; changes: Record<string, unknown> }>> {
  const map = new Map<string, Array<{ step: number; changes: Record<string, unknown> }>>();
  for (const entry of stateHistory) {
    const node = normalizeNodeId(entry.node);
    const list = map.get(node) ?? [];
    list.push({ step: entry.step, changes: entry.changes });
    map.set(node, list);
  }
  return map;
}

export function buildWorkflowGraph(
  metrics: ParsedRunMetrics,
  trace: Record<string, unknown> | undefined,
  workflow: ReturnType<typeof summarizeWorkflowStatus>,
  runContext: Pick<AgentRunContext, "input" | "output">,
  stateHistory?: StateHistoryEntry[],
): WorkflowGraph {
  const spans = spanMap(trace);
  const history = stateHistory?.map((e) => ({
    ...e,
    node: normalizeNodeId(e.node),
  }));

  const timelinePath = executionPath(metrics, trace);

  /** Full execution order for edges — timeline includes every node_end. */
  const path =
    timelinePath.length > 0
      ? timelinePath
      : history && history.length > 0
        ? history.map((e) => e.node)
        : [];

  const pathSteps =
    timelinePath.length > 0
      ? timelinePath.map((node, index) => ({ step: index + 1, node }))
      : history && history.length > 0
        ? history.map((e) => ({ step: e.step, node: e.node }))
        : undefined;

  const visitsByNode = history ? buildVisitsByNode(history) : new Map();

  const transitionsByNode = new Map<string, string[]>();
  if (history) {
    for (const entry of history) {
      const keys = Object.keys(entry.changes);
      const existing = transitionsByNode.get(entry.node) ?? [];
      transitionsByNode.set(entry.node, [...new Set([...existing, ...keys])]);
    }
  } else {
    for (const t of metrics.stateTransitions) {
      transitionsByNode.set(t.node, t.changed);
    }
  }

  const nodes: WorkflowGraphNode[] = ALL_NODES.map(({ id, label }) => {
    const executions = path.filter((n) => n === id);
    const lastIndex = path.lastIndexOf(id);
    const span = spans.get(id);
    const failedEnd = metrics.nodeTimeline.some(
      (e) => e.node === id && e.event === "node_error",
    );
    const visits = visitsByNode.get(id) ?? [];

    const status = history
      ? nodeStatusFromHistory(id, history.filter((e) => e.node === id), span, failedEnd)
      : (() => {
          let s: NodeRunStatus = "skipped";
          if (executions.length > 0) {
            s = failedEnd || (span && !span.success) ? "failed" : "success";
          }
          return s;
        })();

    const stateChanges = transitionsByNode.get(id) ?? [];
    let state: Record<string, unknown>;

    if (visits.length > 0) {
      state = {};
      for (const visit of visits) {
        Object.assign(state, visit.changes);
      }
    } else {
      state = resolveNodeState(id, stateChanges, {
        workflow,
        output: runContext.output,
        input: runContext.input,
        metrics,
      });
    }

    const runCount = executions.length > 1 ? executions.length : undefined;
    if (runCount !== undefined) {
      state.runCount = runCount;
    }

    return {
      id,
      label,
      status,
      order: lastIndex >= 0 ? lastIndex + 1 : undefined,
      durationMs: span?.durationMs,
      stateChanges,
      state,
      runCount,
      visits: visits.length > 0 ? visits : undefined,
    };
  });

  const takenEdges = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    takenEdges.add(`${path[i]}->${path[i + 1]}`);
  }

  const edges: WorkflowGraphEdge[] = GRAPH_EDGES.map(({ from, to, label }) => ({
    from,
    to,
    label,
    taken: takenEdges.has(`${from}->${to}`),
  }));

  return { path, pathSteps, nodes, edges };
}

const NODE_LABELS: Record<string, string> = {
  planner: "Planner",
  answer: "Answer",
  schemaResolver: "Schema resolver",
  graphBuilder: "Relationship graph",
  entityExtractor: "Entity extractor",
  pathFinder: "Path finder",
  operationPlanner: "Operation planner",
  buildQuery: "Build query",
  validateQuery: "Validate query",
  runQuery: "Run query",
  repairQuery: "Repair query",
  formatResponse: "Format response",
};

export interface StateTimelineStep {
  step: number;
  node: string;
  label: string;
  changed: string[];
  changes?: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}

export function buildStateTimeline(
  metrics: ParsedRunMetrics,
  trace: Record<string, unknown> | undefined,
  workflow: ReturnType<typeof summarizeWorkflowStatus>,
  runContext: Pick<AgentRunContext, "input" | "output">,
  stateHistory?: StateHistoryEntry[],
): StateTimelineStep[] {
  const snapshot: Record<string, unknown> = {};

  if (runContext.input?.query) snapshot.query = runContext.input.query;
  if (runContext.input?.dryRun !== undefined) snapshot.dryRun = runContext.input.dryRun;
  if (runContext.input?.priorMessageCount !== undefined) {
    snapshot.priorMessageCount = runContext.input.priorMessageCount;
  }

  if (stateHistory && stateHistory.length > 0) {
    const steps: StateTimelineStep[] = [];
    for (const entry of stateHistory) {
      const node = normalizeNodeId(entry.node);
      Object.assign(snapshot, entry.changes);
      steps.push({
        step: entry.step,
        node,
        label: NODE_LABELS[node] ?? node,
        changed: Object.keys(entry.changes),
        changes: entry.changes,
        snapshot: { ...snapshot },
      });
    }
    return steps;
  }

  const context = {
    workflow,
    output: runContext.output,
    input: runContext.input,
    metrics,
  };

  const steps: StateTimelineStep[] = [];

  if (metrics.stateTransitions.length > 0) {
    for (let i = 0; i < metrics.stateTransitions.length; i++) {
      const transition = metrics.stateTransitions[i];
      const delta = resolveNodeState(transition.node, transition.changed, context);
      Object.assign(snapshot, delta);
      steps.push({
        step: i + 1,
        node: transition.node,
        label: NODE_LABELS[transition.node] ?? transition.node,
        changed: transition.changed,
        snapshot: { ...snapshot },
      });
    }
    return steps;
  }

  const path = executionPath(metrics, trace);
  for (let i = 0; i < path.length; i++) {
    const nodeId = path[i];
    const delta = resolveNodeState(nodeId, [], context);
    Object.assign(snapshot, delta);
    steps.push({
      step: i + 1,
      node: nodeId,
      label: NODE_LABELS[nodeId] ?? nodeId,
      changed: [],
      snapshot: { ...snapshot },
    });
  }

  return steps;
}
