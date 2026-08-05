import type {
  WorkflowTestFailureQuery,
  WorkflowTestGroupRecord,
} from "../api";
import type { StressTestGroupInput } from "./parseQueryGroups";

export function groupsToFormInput(
  groups: WorkflowTestGroupRecord[],
): StressTestGroupInput[] {
  return groups
    .filter((group) => group.kind === "manual")
    .map((group) => ({
      name: group.name,
      queriesText: group.queries.join("\n"),
      categoryType: group.categoryType,
      execution: group.executionOverrides ?? undefined,
    }));
}

export function getFailuresGroup(
  groups: WorkflowTestGroupRecord[],
): WorkflowTestGroupRecord | undefined {
  return groups.find((group) => group.kind === "failures");
}

/**
 * Build an ephemeral failures group from a report's fail/error rows.
 * Does not persist — used by "Load failures in setup" so Run failures can
 * update the same report without saving to a group first.
 */
export function failuresGroupFromReport(input: {
  runId: string | null | undefined;
  results: Array<{
    groupName: string;
    query: string;
    status: string;
  }>;
}): WorkflowTestGroupRecord | null {
  const failureQueries: WorkflowTestFailureQuery[] = [];
  const queries: string[] = [];

  for (const result of input.results) {
    if (result.status !== "fail" && result.status !== "error") continue;
    const query = result.query.trim();
    if (!query) continue;
    failureQueries.push({
      query,
      sourceGroupName: result.groupName || null,
      sourceRunId: input.runId ?? null,
    });
    queries.push(query);
  }

  if (queries.length === 0) return null;

  return {
    id: `ephemeral-failures:${input.runId ?? "unsaved"}`,
    name: "Failed queries",
    kind: "failures",
    sortOrder: 0,
    queries,
    failureQueries,
  };
}

/**
 * Turn report fail/error rows into editable Setup groups, preserving
 * original group names and category types.
 */
export function failureResultsToFormGroups(
  results: Array<{
    groupName: string;
    query: string;
    status: string;
    categoryType?: string;
  }>,
): StressTestGroupInput[] {
  const order: string[] = [];
  const map = new Map<
    string,
    { name: string; categoryType?: StressTestGroupInput["categoryType"]; queries: string[] }
  >();

  for (const result of results) {
    if (result.status !== "fail" && result.status !== "error") continue;
    const query = result.query.trim();
    if (!query) continue;
    const name = result.groupName?.trim() || "Unknown";
    const key = name.toLowerCase();
    let bucket = map.get(key);
    if (!bucket) {
      order.push(key);
      bucket = {
        name,
        categoryType: (result.categoryType as StressTestGroupInput["categoryType"]) ?? "STANDARD",
        queries: [],
      };
      map.set(key, bucket);
    }
    if (!bucket.queries.includes(query)) {
      bucket.queries.push(query);
    }
  }

  return order.map((key) => {
    const bucket = map.get(key)!;
    return {
      name: bucket.name,
      queriesText: bucket.queries.join("\n"),
      categoryType: bucket.categoryType,
    };
  });
}

export function isEphemeralFailuresGroup(
  group: WorkflowTestGroupRecord | null | undefined,
): boolean {
  return Boolean(group?.id.startsWith("ephemeral-failures:"));
}

export function groupFailureQueriesBySource(
  group: WorkflowTestGroupRecord | null | undefined,
): Array<{ sourceGroupName: string; queries: string[] }> {
  if (!group) return [];

  const items: WorkflowTestFailureQuery[] =
    group.failureQueries && group.failureQueries.length > 0
      ? group.failureQueries
      : group.queries.map((query) => ({
          query,
          sourceGroupName: null,
          sourceRunId: null,
        }));

  const order: string[] = [];
  const map = new Map<string, string[]>();

  for (const item of items) {
    const key = item.sourceGroupName?.trim() || "Unknown";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item.query);
  }

  return order.map((sourceGroupName) => ({
    sourceGroupName,
    queries: map.get(sourceGroupName) ?? [],
  }));
}

/** Stable key for live result dedupe across watch replay. */
export function liveResultKey(
  result: { queryKey?: string; groupName: string; query: string },
  index?: number,
): string {
  if (result.queryKey) return result.queryKey;
  const base = `${result.groupName}::${result.query.trim()}`;
  return index === undefined ? base : `${base}::${index}`;
}

/** All aliases that may identify the same live result across hydrate/watch. */
export function liveResultKeyAliases(
  result: { queryKey?: string; groupName: string; query: string },
): string[] {
  const aliases = new Set<string>();
  aliases.add(liveResultKey(result));
  aliases.add(`${result.groupName}::${result.query.trim()}`);
  if (result.queryKey) aliases.add(result.queryKey);
  return [...aliases];
}

export function clampProgressCounts(input: {
  completed: number;
  total: number;
  queryIndex: number;
}): { completed: number; total: number; queryIndex: number; pct: number } {
  const completedRaw = Math.max(0, input.completed);
  // Never display "N of 0" — if total is missing, fall back to completed.
  const total =
    input.total > 0
      ? input.total
      : completedRaw > 0
        ? completedRaw
        : 0;
  const completed =
    total > 0 ? Math.min(completedRaw, total) : 0;
  const queryIndex =
    total > 0
      ? Math.min(Math.max(0, input.queryIndex), total)
      : 0;
  const pct =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return { completed, total, queryIndex, pct };
}

function firstPositive(
  ...values: Array<number | null | undefined>
): number {
  for (const value of values) {
    if (typeof value === "number" && value > 0) return value;
  }
  return 0;
}

/**
 * Resolve progress totals for a running (or recently checkpointed) workflow run.
 * Never treat summary.total / results.length as the planned total while running —
 * those are completed counts from buildStressTestSummary.
 */
export function resolveRunningProgressCounts(input: {
  plannedQueries?: number | null;
  plannedItemsLength?: number | null;
  /** Prior client progress.totalQueries to preserve across reconnect. */
  previousTotal?: number | null;
  resultsLength: number;
  runStatus?: string | null;
}): { completed: number; total: number } {
  const planned = firstPositive(
    input.plannedQueries,
    input.plannedItemsLength,
    input.previousTotal,
  );
  const completedRaw = Math.max(0, input.resultsLength);
  const running =
    input.runStatus === "running" ||
    input.runStatus == null ||
    input.runStatus === undefined;

  if (planned > 0) {
    return {
      completed: Math.min(completedRaw, planned),
      total: planned,
    };
  }

  // Unknown plan while still running: keep completed, do not invent total=completed.
  if (running) {
    return { completed: completedRaw, total: 0 };
  }

  // Terminal runs may use results length as total when plan was never stored.
  return {
    completed: completedRaw,
    total: firstPositive(input.previousTotal, completedRaw),
  };
}

/** Soft-abort a live SSE reader only when it looks hung after sleep/freeze. */
export const STREAM_STALE_MS = 20_000;

export function shouldSoftAbortOnWake(input: {
  hasActiveRunController: boolean;
  hasSoftStreamController: boolean;
  lastProgressAtMs: number | null;
  nowMs: number;
  staleMs?: number;
}): boolean {
  if (!input.hasActiveRunController || !input.hasSoftStreamController) {
    return false;
  }
  if (input.lastProgressAtMs == null) return false;
  const staleMs = input.staleMs ?? STREAM_STALE_MS;
  return input.nowMs - input.lastProgressAtMs >= staleMs;
}

/** Prefer same-report rerun when a linked run exists. */
export function resolveFailuresRunAction(input: {
  linkedRunId: string | null | undefined;
  loadedTestId: string | null | undefined;
  failuresGroupId: string | null | undefined;
}):
  | { type: "rerun-report"; runId: string }
  | { type: "run-group"; testId: string; groupId: string }
  | null {
  if (input.linkedRunId) {
    return { type: "rerun-report", runId: input.linkedRunId };
  }
  if (input.loadedTestId && input.failuresGroupId) {
    return {
      type: "run-group",
      testId: input.loadedTestId,
      groupId: input.failuresGroupId,
    };
  }
  return null;
}
