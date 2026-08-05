import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { isRunActive } from "./workflowTestRunManager.js";
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
  parseStoredResults,
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

/**
 * Planned total for /watch start payloads.
 * Never use summary.total / results.length as the plan while the run is still
 * running — those are completed counts from buildStressTestSummary.
 */
export function resolveWatchPlannedTotal(input: {
  plannedQueries?: number | null;
  plannedItemsLength: number;
  resultsLength: number;
  summaryTotal?: number | null;
  runStatus?: string | null;
}): number {
  const plannedQueries =
    typeof input.plannedQueries === "number" && input.plannedQueries > 0
      ? input.plannedQueries
      : 0;
  if (plannedQueries > 0) return plannedQueries;
  if (input.plannedItemsLength > 0) return input.plannedItemsLength;

  const running =
    input.runStatus === "running" ||
    input.runStatus == null ||
    input.runStatus === undefined;
  if (running) return 0;

  const summaryTotal =
    typeof input.summaryTotal === "number" && input.summaryTotal > 0
      ? input.summaryTotal
      : 0;
  if (summaryTotal > 0) return summaryTotal;
  return Math.max(0, input.resultsLength);
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

/** Terminal status for a DB row stuck as `running` with no in-memory executor. */
export function orphanedRunTerminalStatus(
  resultsCount: number,
  plannedCount: number,
): Exclude<WorkflowRunStatus, "running"> {
  if (plannedCount > 0 && resultsCount >= plannedCount) return "completed";
  if (resultsCount > 0) return "partial";
  return "cancelled";
}

/**
 * If a run is marked `running` in the DB but has no live executor (server restart,
 * crashed worker, abandoned cancel), rewrite it to a terminal status so refresh/
 * watch do not pretend it is still executing.
 */
export async function finalizeOrphanedRunningRun(
  runId: string,
  userId: string,
): Promise<{
  healed: boolean;
  summary: StressTestSummary;
  results: QueryRunResult[];
} | null> {
  if (isRunActive(runId)) {
    return null;
  }

  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run) return null;

  const summary = parseStoredSummary(run.summary);
  const results = parseStoredResults(run.results);
  if (summary.runStatus !== "running") {
    return { healed: false, summary, results };
  }

  const plannedItems = parsePlannedItems(run.summary);
  const plannedCount = summary.plannedQueries ?? plannedItems.length;
  const runStatus = orphanedRunTerminalStatus(results.length, plannedCount);
  const nextSummary = buildWorkflowRunSummary(
    results,
    plannedCount,
    runStatus,
    plannedItems.length > 0 ? plannedItems : summary.plannedItems,
  );

  await prisma.workflowTestRun.update({
    where: { id: runId },
    data: {
      summary: nextSummary as unknown as Prisma.InputJsonValue,
    },
  });

  return { healed: true, summary: nextSummary, results };
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
