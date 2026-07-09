import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import {
  buildStressTestSummary,
  type PlannedQueryItem,
  type QueryRunResult,
  type StressTestSummary,
  type WorkflowRunStatus,
} from "./stressTestAnalyze.js";
import {
  augmentSummaryWithObservability,
  buildQueryKey,
  normalizeQueryRunResult,
  parseStoredSummary,
} from "./workflowTestObservability.js";
import { persistNewWorkflowExecutions } from "./workflowTestRunExecutor.js";

export interface WorkflowRunCheckpointState {
  runId: string;
  userId: string;
  results: QueryRunResult[];
  plannedItems: PlannedQueryItem[];
  persistedCount: number;
}

export function buildWorkflowRunSummary(
  results: QueryRunResult[],
  plannedCount: number,
  runStatus: WorkflowRunStatus,
  plannedItems?: PlannedQueryItem[],
): StressTestSummary {
  const base = augmentSummaryWithObservability(
    buildStressTestSummary(results),
    results,
  );
  return {
    ...base,
    runStatus,
    plannedQueries: plannedCount,
    plannedItems,
  };
}

export function parsePlannedItems(summary: unknown): PlannedQueryItem[] {
  const parsed = parseStoredSummary(summary);
  if (!Array.isArray(parsed.plannedItems)) return [];
  return parsed.plannedItems.filter(
    (item): item is PlannedQueryItem =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as PlannedQueryItem).groupName === "string" &&
          typeof (item as PlannedQueryItem).query === "string",
      ),
  );
}

export function collectRemainingItems(
  plannedItems: PlannedQueryItem[],
  results: QueryRunResult[],
): PlannedQueryItem[] {
  const completedKeys = new Set(
    results.map(
      (result) =>
        normalizeQueryRunResult(result).queryKey ??
        buildQueryKey(result.groupName, result.query),
    ),
  );
  return plannedItems.filter(
    (item) => !completedKeys.has(buildQueryKey(item.groupName, item.query)),
  );
}

export function isResumableRunSummary(
  summary: StressTestSummary,
  completedCount: number,
): boolean {
  const planned = summary.plannedQueries ?? 0;
  const status = summary.runStatus;
  if (planned <= 0 || completedCount >= planned) return false;
  return (
    status === "running" ||
    status === "partial" ||
    status === "cancelled"
  );
}

export async function checkpointWorkflowRun(
  state: WorkflowRunCheckpointState,
  runStatus: WorkflowRunStatus,
  extra?: { dryRun?: boolean; delayMs?: number },
): Promise<void> {
  const summary = buildWorkflowRunSummary(
    state.results,
    state.plannedItems.length,
    runStatus,
    state.plannedItems,
  );

  await prisma.workflowTestRun.update({
    where: { id: state.runId },
    data: {
      summary: summary as unknown as Prisma.InputJsonValue,
      results: state.results as unknown as Prisma.InputJsonValue,
      ...(extra?.dryRun !== undefined ? { dryRun: extra.dryRun } : {}),
      ...(extra?.delayMs !== undefined ? { delayMs: extra.delayMs } : {}),
    },
  });

  state.persistedCount = await persistNewWorkflowExecutions(
    state.userId,
    state.runId,
    state.results,
    state.persistedCount,
  );
}
