import type {
  FailurePhase,
  QueryRunResult,
  WorkflowTestCompletePayload,
  WorkflowTestSummary,
} from "../api";

export interface StatusBreakdown {
  passed: number;
  failed: number;
  errors: number;
  plannerSkipped: number;
}

export interface GroupOutcome {
  groupName: string;
  passed: number;
  failed: number;
  errors: number;
  plannerSkipped: number;
  total: number;
}

export interface PhaseOutcome {
  phase: FailurePhase;
  count: number;
}

export interface QueryMetricRow {
  key: string;
  label: string;
  groupName: string;
  query: string;
  durationMs: number;
  totalTokens: number;
  status: QueryRunResult["status"];
  executionCount: number;
}

export interface NodeLlmMetric {
  node: string;
  callCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AttemptDistribution {
  executionCount: number;
  queryCount: number;
}

export interface RunMetrics {
  overview: {
    passRate: number;
    totalQueries: number;
    avgDurationMs: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    llmCallCount: number;
  };
  statusBreakdown: StatusBreakdown;
  byGroup: GroupOutcome[];
  byPhase: PhaseOutcome[];
  perQuery: QueryMetricRow[];
  llmByNode: NodeLlmMetric[];
  attemptDistribution: AttemptDistribution[];
}

export interface CompareMetricDeltas {
  passRateDelta: number;
  totalTokensDelta: number;
  avgDurationMsDelta: number;
  errorCountDelta: number;
}

export interface CompareMetrics {
  a: RunMetrics;
  b: RunMetrics;
  deltas: CompareMetricDeltas;
  perQueryOverlap: Array<{
    key: string;
    label: string;
    query: string;
    groupName: string;
    durationA: number;
    durationB: number;
    durationDelta: number;
    tokensA: number;
    tokensB: number;
    tokensDelta: number;
    statusA: QueryRunResult["status"] | null;
    statusB: QueryRunResult["status"] | null;
  }>;
}

function truncateLabel(text: string, max = 48): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function queryKey(result: QueryRunResult, index: number): string {
  return result.queryKey ?? `${result.groupName}::${result.query}::${index}`;
}

function aggregateLlmByNode(results: QueryRunResult[]): NodeLlmMetric[] {
  const byNode = new Map<string, NodeLlmMetric>();

  for (const result of results) {
    const attempts = result.attempts ?? [];
    for (const attempt of attempts) {
      for (const call of attempt.llmCalls) {
        const node = call.node ?? "unknown";
        const existing = byNode.get(node) ?? {
          node,
          callCount: 0,
          totalLatencyMs: 0,
          avgLatencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        };
        existing.callCount += 1;
        existing.totalLatencyMs += call.latencyMs ?? 0;
        existing.promptTokens += call.promptTokens ?? 0;
        existing.completionTokens += call.completionTokens ?? 0;
        existing.totalTokens += call.totalTokens ?? 0;
        byNode.set(node, existing);
      }
    }
  }

  return [...byNode.values()]
    .map((entry) => ({
      ...entry,
      avgLatencyMs:
        entry.callCount > 0
          ? Math.round(entry.totalLatencyMs / entry.callCount)
          : 0,
    }))
    .sort((a, b) => b.callCount - a.callCount);
}

function aggregateAttempts(results: QueryRunResult[]): AttemptDistribution[] {
  const counts = new Map<number, number>();
  for (const result of results) {
    const executionCount = result.executionCount ?? result.attempts?.length ?? 1;
    counts.set(executionCount, (counts.get(executionCount) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([executionCount, queryCount]) => ({ executionCount, queryCount }))
    .sort((a, b) => a.executionCount - b.executionCount);
}

function buildPerQuery(results: QueryRunResult[]): QueryMetricRow[] {
  return results.map((result, index) => ({
    key: queryKey(result, index),
    label: truncateLabel(result.query),
    groupName: result.groupName,
    query: result.query,
    durationMs: result.durationMs,
    totalTokens: result.totalTokens ?? 0,
    status: result.status,
    executionCount: result.executionCount ?? result.attempts?.length ?? 1,
  }));
}

function buildByGroup(summary: WorkflowTestSummary): GroupOutcome[] {
  return Object.entries(summary.byGroup).map(([groupName, group]) => ({
    groupName,
    passed: group.passed,
    failed: group.failed,
    errors: group.errors,
    plannerSkipped: group.plannerSkipped,
    total: group.total,
  }));
}

function buildByPhase(summary: WorkflowTestSummary): PhaseOutcome[] {
  return Object.entries(summary.byPhase ?? {})
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([phase, count]) => ({
      phase: phase as FailurePhase,
      count: count ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

function avgDuration(results: QueryRunResult[]): number {
  if (results.length === 0) return 0;
  const total = results.reduce((sum, result) => sum + result.durationMs, 0);
  return Math.round(total / results.length);
}

export function buildRunMetrics(
  report: WorkflowTestCompletePayload,
): RunMetrics {
  const { summary, results } = report;
  const totalQueries = summary.total || results.length;
  const passRate =
    totalQueries > 0 ? Math.round((summary.passed / totalQueries) * 100) : 0;

  return {
    overview: {
      passRate,
      totalQueries,
      avgDurationMs: avgDuration(results),
      totalTokens: summary.totalTokens ?? 0,
      promptTokens: summary.promptTokens ?? 0,
      completionTokens: summary.completionTokens ?? 0,
      llmCallCount: summary.llmCallCount ?? 0,
    },
    statusBreakdown: {
      passed: summary.passed,
      failed: summary.failed,
      errors: summary.errors,
      plannerSkipped: summary.plannerSkipped,
    },
    byGroup: buildByGroup(summary),
    byPhase: buildByPhase(summary),
    perQuery: buildPerQuery(results),
    llmByNode: aggregateLlmByNode(results),
    attemptDistribution: aggregateAttempts(results),
  };
}

export function buildCompareMetrics(
  reportA: WorkflowTestCompletePayload,
  reportB: WorkflowTestCompletePayload,
): CompareMetrics {
  const a = buildRunMetrics(reportA);
  const b = buildRunMetrics(reportB);

  const indexB = new Map<string, QueryMetricRow>();
  for (const row of b.perQuery) {
    indexB.set(`${row.groupName}::${row.query}`, row);
  }

  const perQueryOverlap = a.perQuery
    .map((rowA) => {
      const rowB = indexB.get(`${rowA.groupName}::${rowA.query}`);
      if (!rowB) return null;
      return {
        key: rowA.key,
        label: rowA.label,
        query: rowA.query,
        groupName: rowA.groupName,
        durationA: rowA.durationMs,
        durationB: rowB.durationMs,
        durationDelta: rowB.durationMs - rowA.durationMs,
        tokensA: rowA.totalTokens,
        tokensB: rowB.totalTokens,
        tokensDelta: rowB.totalTokens - rowA.totalTokens,
        statusA: rowA.status,
        statusB: rowB.status,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    a,
    b,
    deltas: {
      passRateDelta: b.overview.passRate - a.overview.passRate,
      totalTokensDelta: b.overview.totalTokens - a.overview.totalTokens,
      avgDurationMsDelta: b.overview.avgDurationMs - a.overview.avgDurationMs,
      errorCountDelta:
        b.statusBreakdown.errors - a.statusBreakdown.errors,
    },
    perQueryOverlap,
  };
}
