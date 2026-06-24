import type { InvokeResult } from "../../types/index.js";
import type { StateHistoryEntry } from "../../schemas/state.js";

export type StressRunStatus = "pass" | "fail" | "error" | "planner_skip";

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
  status: StressRunStatus;
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

export interface StressTestSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  plannerSkipped: number;
  byPhase: Partial<Record<FailurePhase, number>>;
  byGroup: Record<
    string,
    { total: number; passed: number; failed: number; errors: number; plannerSkipped: number }
  >;
}

interface WorkflowSummary {
  status?: string;
  isDomainSpecific?: boolean;
  requiresSql?: boolean;
  validationPassed?: boolean;
  answerSatisfied?: boolean;
  sqlParserPassed?: boolean;
  sqlParserError?: string;
}

interface GraphNodeSummary {
  id: string;
  label?: string;
  status?: string;
  state?: Record<string, unknown>;
}

const NODE_LABELS: Record<string, string> = {
  planner: "Planner",
  answer: "Answer",
  schemaResolver: "Schema resolver",
  buildQuery: "Build query",
  validateQuery: "Validate query",
  runQuery: "Run query",
  formatResponse: "Format response",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function parseStateHistory(value: unknown): StateHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: StateHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.node !== "string") continue;
    const step =
      typeof record.step === "number" ? record.step : entries.length + 1;
    const changes =
      record.changes &&
      typeof record.changes === "object" &&
      !Array.isArray(record.changes)
        ? (record.changes as Record<string, unknown>)
        : {};
    entries.push({ step, node: record.node, changes });
  }
  return entries;
}

function normalizeNodeId(node: string): string {
  return node === "getSchema" ? "schemaResolver" : node;
}

function lastVisitForNode(
  history: StateHistoryEntry[],
  nodeId: string,
): StateHistoryEntry | undefined {
  const normalized = normalizeNodeId(nodeId);
  return history.filter((e) => normalizeNodeId(e.node) === normalized).at(-1);
}

function executionSucceeded(
  history: StateHistoryEntry[],
  result?: InvokeResult,
): boolean | undefined {
  const runVisit = lastVisitForNode(history, "runQuery");
  if (runVisit) {
    if (runVisit.changes.executionSucceeded === false) return false;
    if (
      typeof runVisit.changes.executionError === "string" &&
      runVisit.changes.executionError.length > 0
    ) {
      return false;
    }
    if (runVisit.changes.executionSucceeded === true) return true;
  }

  if (result?.executionResult !== undefined) return true;
  return undefined;
}

function pathHasTransition(path: string[], from: string, to: string): boolean {
  for (let i = 0; i < path.length - 1; i += 1) {
    if (path[i] === from && path[i + 1] === to) return true;
  }
  return false;
}

function findFailedNode(
  graphNodes: GraphNodeSummary[],
  metricsTimeline: Array<{ node?: string; event?: string }>,
): string | undefined {
  const failedGraphNode = graphNodes.find((n) => n.status === "failed");
  if (failedGraphNode) return failedGraphNode.id;

  const errorEvents = metricsTimeline.filter((e) => e.event === "node_error");
  const lastError = errorEvents.at(-1);
  if (typeof lastError?.node === "string") {
    return normalizeNodeId(lastError.node);
  }

  return undefined;
}

function responseTextFromNode(
  nodeId: string,
  state: Record<string, unknown>,
  result?: InvokeResult,
): string | undefined {
  if (nodeId === "answer" || nodeId === "formatResponse") {
    if (result?.markdownResponse) return result.markdownResponse;
    if (typeof state.preview === "string" && state.preview.length > 0) {
      return state.preview;
    }
    if (typeof state.markdownResponse === "string") {
      return state.markdownResponse;
    }
  }

  if (typeof state.executionError === "string" && state.executionError.length > 0) {
    return state.executionError;
  }

  if (Array.isArray(state.validationErrors) && state.validationErrors.length > 0) {
    return state.validationErrors.map(String).join("\n");
  }

  if (typeof state.sqlParserError === "string" && state.sqlParserError.length > 0) {
    return state.sqlParserError;
  }

  if (typeof state.reason === "string" && state.reason.length > 0) {
    return state.reason;
  }

  if (typeof state.plannerReason === "string" && state.plannerReason.length > 0) {
    return state.plannerReason;
  }

  return undefined;
}

function resolveFailedNodeForResponse(
  failedNode: string | undefined,
  failurePhase: FailurePhase,
  path: string[],
): string | undefined {
  if (failedNode) return failedNode;
  if (failurePhase === "execution") return "runQuery";
  if (failurePhase === "query_build") return "validateQuery";
  if (path.at(-1) === "answer") return "answer";
  return path.at(-1);
}

function buildFailedNodeResponse(
  nodeId: string | undefined,
  graphNodes: GraphNodeSummary[],
  history: StateHistoryEntry[],
  result?: InvokeResult,
): FailedNodeResponse | undefined {
  if (!nodeId) return undefined;

  const graphNode = graphNodes.find((n) => n.id === nodeId);
  const historyVisit = lastVisitForNode(history, nodeId);
  const state: Record<string, unknown> = {
    ...(graphNode?.state ?? {}),
    ...(historyVisit?.changes ?? {}),
  };

  if (Object.keys(state).length === 0 && !result?.markdownResponse) {
    return undefined;
  }

  return {
    node: nodeId,
    label: graphNode?.label ?? NODE_LABELS[nodeId] ?? nodeId,
    text: responseTextFromNode(nodeId, state, result),
    state,
  };
}

function attachFailureDetails(
  result: QueryRunResult,
  params: {
    failedNode?: string;
    failurePhase: FailurePhase;
    path: string[];
    graphNodes: GraphNodeSummary[];
    history: StateHistoryEntry[];
    invokeResult?: InvokeResult;
  },
): QueryRunResult {
  if (result.status === "pass") {
    return result;
  }

  const responseNode = resolveFailedNodeForResponse(
    params.failedNode,
    params.failurePhase,
    params.path,
  );
  const failureState = responseNode
    ? lastVisitForNode(params.history, responseNode)?.changes
    : undefined;
  const failedNodeResponse = buildFailedNodeResponse(
    responseNode,
    params.graphNodes,
    params.history,
    params.invokeResult,
  );

  return {
    ...result,
    failedNode: params.failedNode ?? responseNode,
    failureState: failureState ?? failedNodeResponse?.state,
    failedNodeResponse,
  };
}

function detectFailurePhase(params: {
  workflow: WorkflowSummary;
  path: string[];
  history: StateHistoryEntry[];
  dryRun: boolean;
  executionOk: boolean | undefined;
}): FailurePhase {
  const { workflow, path, history, dryRun, executionOk } = params;

  if (workflow.requiresSql === false || workflow.isDomainSpecific === false) {
    return "planner";
  }

  if (workflow.validationPassed === false || workflow.sqlParserPassed === false) {
    return "query_build";
  }

  if (pathHasTransition(path, "validateQuery", "answer")) {
    return "query_build";
  }

  const validateVisit = lastVisitForNode(history, "validateQuery");
  if (
    validateVisit?.changes.validationPassed === false ||
    validateVisit?.changes.sqlParserPassed === false
  ) {
    return "query_build";
  }

  if (!dryRun && executionOk === false) {
    return "execution";
  }

  const runVisit = lastVisitForNode(history, "runQuery");
  if (
    runVisit?.changes.executionSucceeded === false ||
    (typeof runVisit?.changes.executionError === "string" &&
      runVisit.changes.executionError.length > 0)
  ) {
    return "execution";
  }

  if (
    pathHasTransition(path, "runQuery", "answer") ||
    (path.includes("runQuery") &&
      path.at(-1) === "answer" &&
      executionOk === false)
  ) {
    return "execution";
  }

  return "none";
}

export function analyzeStressRunResult(params: {
  query: string;
  groupName: string;
  result?: InvokeResult;
  debug?: unknown;
  durationMs: number;
  dryRun?: boolean;
  errorMessage?: string;
  requestId?: string;
}): QueryRunResult {
  const {
    query,
    groupName,
    result,
    debug,
    durationMs,
    dryRun = false,
    errorMessage,
    requestId,
  } = params;

  const base: QueryRunResult = {
    groupName,
    query,
    status: "fail",
    failurePhase: "none",
    durationMs,
    requestId,
    markdownPreview: result?.markdownResponse?.slice(0, 240),
    markdownResponse: result?.markdownResponse,
    generatedSql: result?.generatedSql ?? null,
  };

  if (errorMessage) {
    return {
      ...base,
      status: "error",
      failurePhase: "agent_error",
      errorMessage,
    };
  }

  const debugRecord = asRecord(debug);
  const workflow = (asRecord(debugRecord?.workflow) ?? {}) as WorkflowSummary;
  const graph = asRecord(debugRecord?.graph);
  const metrics = asRecord(debugRecord?.metrics);
  const history = parseStateHistory(debugRecord?.stateHistory);

  const graphNodes = Array.isArray(graph?.nodes)
    ? (graph.nodes as GraphNodeSummary[])
    : [];
  const path = Array.isArray(graph?.path)
    ? (graph.path as string[]).map(normalizeNodeId)
    : history.map((e) => normalizeNodeId(e.node));

  const metricsTimeline = Array.isArray(metrics?.nodeTimeline)
    ? (metrics.nodeTimeline as Array<{ node?: string; event?: string }>)
    : [];

  const executionOk = executionSucceeded(history, result);
  const failurePhase = detectFailurePhase({
    workflow,
    path,
    history,
    dryRun,
    executionOk,
  });

  const failedNode = findFailedNode(graphNodes, metricsTimeline);
  const detailParams = {
    failedNode,
    failurePhase,
    path,
    graphNodes,
    history,
    invokeResult: result,
  };

  const skippedSqlPath =
    workflow.requiresSql === false || workflow.isDomainSpecific === false;

  if (skippedSqlPath) {
    return attachFailureDetails(
      {
        ...base,
        status: "planner_skip",
        failurePhase: "planner",
        workflowPath: path,
        workflowStatus: workflow.status,
      },
      { ...detailParams, failurePhase: "planner" },
    );
  }

  const validationFailed = workflow.validationPassed === false;
  const traceFailed = workflow.status === "failed";
  const executionFailed = !dryRun && executionOk === false;

  const passed =
    !traceFailed &&
    !validationFailed &&
    !executionFailed &&
    failurePhase === "none";

  const resolvedPhase = passed
    ? "none"
    : failurePhase === "none"
      ? "query_build"
      : failurePhase;

  return attachFailureDetails(
    {
      ...base,
      status: passed ? "pass" : "fail",
      failurePhase: resolvedPhase,
      workflowPath: path,
      workflowStatus: workflow.status,
      generatedSql:
        result?.generatedSql ??
        (typeof debugRecord?.output === "object"
          ? ((debugRecord?.output as Record<string, unknown>).generatedSql as
              | string
              | null
              | undefined)
          : null) ??
        null,
    },
    { ...detailParams, failurePhase: resolvedPhase },
  );
}

export function buildStressTestSummary(
  results: QueryRunResult[],
): StressTestSummary {
  const summary: StressTestSummary = {
    total: results.length,
    passed: 0,
    failed: 0,
    errors: 0,
    plannerSkipped: 0,
    byPhase: {},
    byGroup: {},
  };

  for (const result of results) {
    const groupStats = summary.byGroup[result.groupName] ?? {
      total: 0,
      passed: 0,
      failed: 0,
      errors: 0,
      plannerSkipped: 0,
    };

    groupStats.total += 1;

    if (result.status === "pass") {
      summary.passed += 1;
      groupStats.passed += 1;
    } else if (result.status === "error") {
      summary.errors += 1;
      groupStats.errors += 1;
    } else if (result.status === "planner_skip") {
      summary.plannerSkipped += 1;
      groupStats.plannerSkipped += 1;
    } else {
      summary.failed += 1;
      groupStats.failed += 1;
    }

    if (result.failurePhase !== "none") {
      summary.byPhase[result.failurePhase] =
        (summary.byPhase[result.failurePhase] ?? 0) + 1;
    }

    summary.byGroup[result.groupName] = groupStats;
  }

  return summary;
}
