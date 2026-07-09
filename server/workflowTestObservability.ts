import { normalizeQueryKey } from "./workflowTestGroups.js";
import type { AttemptTokenMetrics } from "./extractRunMetrics.js";
import type {
  QueryRunResult,
  StressRunStatus,
  StressTestSummary,
} from "./stressTestAnalyze.js";

export type QueryAttemptKind = "initial" | "rerun";

export interface LlmCallUsage {
  node?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface QueryAttempt {
  attemptNumber: number;
  kind: QueryAttemptKind;
  ranAt: string;
  status: StressRunStatus;
  durationMs: number;
  requestId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCalls: LlmCallUsage[];
  failurePhase: QueryRunResult["failurePhase"];
  failedNode?: string;
  failureState?: Record<string, unknown>;
  failedNodeResponse?: QueryRunResult["failedNodeResponse"];
  generatedSql?: string | null;
  markdownPreview?: string;
  markdownResponse?: string;
  workflowPath?: string[];
  workflowStatus?: string;
  errorMessage?: string;
}

export interface WorkflowTestReportPayload {
  testId?: string;
  runId?: string;
  testName: string;
  dryRun: boolean;
  delayMs?: number;
  database: { dbType: string; name: string; host: string };
  ranAt: string;
  agent?: {
    id: string;
    name: string;
    llmProvider: string | null;
    modelName: string | null;
  };
  summary: StressTestSummary;
  results: QueryRunResult[];
}

export function buildQueryKey(groupName: string, query: string): string {
  return `${groupName}::${normalizeQueryKey(query)}`;
}

function attemptDetailFromResult(result: QueryRunResult): Omit<
  QueryAttempt,
  | "attemptNumber"
  | "kind"
  | "ranAt"
  | "promptTokens"
  | "completionTokens"
  | "totalTokens"
  | "llmCalls"
> {
  return {
    status: result.status,
    durationMs: result.durationMs,
    requestId: result.requestId,
    failurePhase: result.failurePhase,
    failedNode: result.failedNode,
    failureState: result.failureState,
    failedNodeResponse: result.failedNodeResponse,
    generatedSql: result.generatedSql,
    markdownPreview: result.markdownPreview,
    markdownResponse: result.markdownResponse,
    workflowPath: result.workflowPath,
    workflowStatus: result.workflowStatus,
    errorMessage: result.errorMessage,
  };
}

export function buildInitialAttempt(
  result: QueryRunResult,
  metrics: AttemptTokenMetrics,
  ranAt: Date,
): QueryAttempt {
  return {
    attemptNumber: 1,
    kind: "initial",
    ranAt: ranAt.toISOString(),
    promptTokens: metrics.promptTokens,
    completionTokens: metrics.completionTokens,
    totalTokens: metrics.totalTokens,
    llmCalls: metrics.llmCalls,
    ...attemptDetailFromResult(result),
  };
}

export function buildRerunAttempt(
  result: QueryRunResult,
  metrics: AttemptTokenMetrics,
  attemptNumber: number,
  ranAt: Date,
): QueryAttempt {
  return {
    attemptNumber,
    kind: "rerun",
    ranAt: ranAt.toISOString(),
    promptTokens: metrics.promptTokens,
    completionTokens: metrics.completionTokens,
    totalTokens: metrics.totalTokens,
    llmCalls: metrics.llmCalls,
    ...attemptDetailFromResult(result),
  };
}

function sumAttemptTokens(attempts: QueryAttempt[]): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  return attempts.reduce(
    (acc, attempt) => ({
      promptTokens: acc.promptTokens + attempt.promptTokens,
      completionTokens: acc.completionTokens + attempt.completionTokens,
      totalTokens: acc.totalTokens + attempt.totalTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

export function enrichQueryRunResult(
  result: QueryRunResult,
  metrics: AttemptTokenMetrics,
  ranAt: Date,
): QueryRunResult {
  const queryKey = buildQueryKey(result.groupName, result.query);
  const attempt = buildInitialAttempt(result, metrics, ranAt);
  const tokens = sumAttemptTokens([attempt]);

  return {
    ...result,
    queryKey,
    attempts: [attempt],
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    totalTokens: tokens.totalTokens,
    executionCount: 1,
  };
}

export function normalizeQueryRunResult(result: QueryRunResult): QueryRunResult {
  const queryKey =
    result.queryKey ?? buildQueryKey(result.groupName, result.query);

  if (result.attempts && result.attempts.length > 0) {
    const tokens = sumAttemptTokens(result.attempts);
    return {
      ...result,
      queryKey,
      promptTokens: result.promptTokens ?? tokens.promptTokens,
      completionTokens: result.completionTokens ?? tokens.completionTokens,
      totalTokens: result.totalTokens ?? tokens.totalTokens,
      executionCount: result.executionCount ?? result.attempts.length,
    };
  }

  const syntheticAttempt: QueryAttempt = {
    attemptNumber: 1,
    kind: "initial",
    ranAt: new Date(0).toISOString(),
    promptTokens: result.promptTokens ?? 0,
    completionTokens: result.completionTokens ?? 0,
    totalTokens: result.totalTokens ?? 0,
    llmCalls: [],
    ...attemptDetailFromResult(result),
  };

  return {
    ...result,
    queryKey,
    attempts: [syntheticAttempt],
    promptTokens: result.promptTokens ?? 0,
    completionTokens: result.completionTokens ?? 0,
    totalTokens: result.totalTokens ?? 0,
    executionCount: result.executionCount ?? 1,
  };
}

export function normalizeRunReport<T extends WorkflowTestReportPayload>(
  report: T,
): T {
  const results = report.results.map(normalizeQueryRunResult);
  return {
    ...report,
    results,
    summary: augmentSummaryWithObservability(report.summary, results),
  };
}

export function augmentSummaryWithObservability(
  summary: StressTestSummary,
  results: QueryRunResult[],
): StressTestSummary {
  let executionCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let llmCallCount = 0;

  for (const result of results) {
    const normalized = normalizeQueryRunResult(result);
    executionCount += normalized.executionCount ?? normalized.attempts?.length ?? 1;
    promptTokens += normalized.promptTokens ?? 0;
    completionTokens += normalized.completionTokens ?? 0;
    totalTokens += normalized.totalTokens ?? 0;
    for (const attempt of normalized.attempts ?? []) {
      llmCallCount += attempt.llmCalls.length;
    }
  }

  return {
    ...summary,
    executionCount: summary.executionCount ?? executionCount,
    promptTokens: summary.promptTokens ?? promptTokens,
    completionTokens: summary.completionTokens ?? completionTokens,
    totalTokens: summary.totalTokens ?? totalTokens,
    llmCallCount: summary.llmCallCount ?? llmCallCount,
  };
}

export function collectFailedForRerun(
  results: QueryRunResult[],
): QueryRunResult[] {
  return results
    .map(normalizeQueryRunResult)
    .filter((result) => result.status === "fail" || result.status === "error");
}

export function mergeRerunAttempt(
  existing: QueryRunResult,
  rerunResult: QueryRunResult,
  metrics: AttemptTokenMetrics,
  ranAt: Date,
): QueryRunResult {
  const normalized = normalizeQueryRunResult(existing);
  const attemptNumber = (normalized.attempts?.length ?? 0) + 1;
  const attempt = buildRerunAttempt(rerunResult, metrics, attemptNumber, ranAt);
  const attempts = [...(normalized.attempts ?? []), attempt];
  const tokens = sumAttemptTokens(attempts);

  return {
    ...rerunResult,
    queryKey: normalized.queryKey,
    attempts,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    totalTokens: tokens.totalTokens,
    executionCount: attempts.length,
  };
}

export function mergeRerunResults(
  existingResults: QueryRunResult[],
  reruns: Array<{
    queryKey: string;
    result: QueryRunResult;
    metrics: AttemptTokenMetrics;
    ranAt: Date;
  }>,
): QueryRunResult[] {
  const rerunByKey = new Map(reruns.map((item) => [item.queryKey, item]));

  return existingResults.map((existing) => {
    const normalized = normalizeQueryRunResult(existing);
    const key = normalized.queryKey!;
    const rerun = rerunByKey.get(key);
    if (!rerun) return normalized;
    return mergeRerunAttempt(normalized, rerun.result, rerun.metrics, rerun.ranAt);
  });
}

export function parseStoredResults(value: unknown): QueryRunResult[] {
  if (!Array.isArray(value)) return [];
  return value as QueryRunResult[];
}

export function parseStoredSummary(value: unknown): StressTestSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      errors: 0,
      plannerSkipped: 0,
      byPhase: {},
      byGroup: {},
    };
  }
  return value as StressTestSummary;
}
