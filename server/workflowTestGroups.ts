import type { WorkflowTestGroupKind } from "@prisma/client";
import { prisma } from "./db.js";
import type { WorkflowTestGroupRecord } from "./parseStressQueries.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

export const FAILURES_GROUP_NAME = "Failed queries";
export const FAILURES_GROUP_SORT_ORDER = 9999;

export function normalizeQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function collectFailuresForImport(
  results: QueryRunResult[],
  existingQueries: string[],
): Array<{ query: string; groupName: string }> {
  const existingKeys = new Set(
    existingQueries.map((query) => normalizeQueryKey(query)),
  );
  const collected: Array<{ query: string; groupName: string }> = [];

  for (const result of results) {
    if (result.status !== "fail" && result.status !== "error") continue;

    const key = normalizeQueryKey(result.query);
    if (!key || existingKeys.has(key)) continue;

    existingKeys.add(key);
    collected.push({
      query: result.query.trim(),
      groupName: result.groupName,
    });
  }

  return collected;
}

function toGroupRecord(row: {
  id: string;
  name: string;
  kind: WorkflowTestGroupKind;
  sortOrder: number;
  queries: Array<{ query: string }>;
}): WorkflowTestGroupRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sortOrder,
    queries: row.queries.map((q) => q.query),
  };
}

const groupInclude = {
  queries: { orderBy: { sortOrder: "asc" as const } },
} as const;

export async function loadTestGroups(
  testId: string,
): Promise<WorkflowTestGroupRecord[]> {
  const groups = await prisma.workflowTestGroup.findMany({
    where: { workflowTestId: testId },
    orderBy: { sortOrder: "asc" },
    include: groupInclude,
  });

  return groups.map(toGroupRecord);
}

export async function ensureFailuresGroup(testId: string): Promise<string> {
  const existing = await prisma.workflowTestGroup.findFirst({
    where: { workflowTestId: testId, kind: "failures" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.workflowTestGroup.create({
    data: {
      workflowTestId: testId,
      name: FAILURES_GROUP_NAME,
      kind: "failures",
      sortOrder: FAILURES_GROUP_SORT_ORDER,
    },
  });
  return created.id;
}

export async function saveManualGroups(
  testId: string,
  manualGroups: Array<{ name: string; queries: string[] }>,
): Promise<WorkflowTestGroupRecord[]> {
  await ensureFailuresGroup(testId);

  const existing = await prisma.workflowTestGroup.findMany({
    where: { workflowTestId: testId },
    select: { id: true, kind: true },
  });

  const manualIds = existing
    .filter((g) => g.kind === "manual")
    .map((g) => g.id);

  if (manualIds.length > 0) {
    await prisma.workflowTestGroup.deleteMany({
      where: { id: { in: manualIds } },
    });
  }

  for (let index = 0; index < manualGroups.length; index += 1) {
    const group = manualGroups[index]!;
    const created = await prisma.workflowTestGroup.create({
      data: {
        workflowTestId: testId,
        name: group.name,
        kind: "manual",
        sortOrder: index,
        queries: {
          create: group.queries.map((query, queryIndex) => ({
            query,
            sortOrder: queryIndex,
          })),
        },
      },
    });
    void created;
  }

  return loadTestGroups(testId);
}

export interface ImportFailuresResult {
  groups: WorkflowTestGroupRecord[];
  added: number;
  skipped: number;
}

export async function importFailuresFromRun(
  testId: string,
  runId: string,
  userId: string,
): Promise<ImportFailuresResult> {
  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, workflowTestId: testId, userId },
  });
  if (!run) {
    throw new Error("Workflow test run not found.");
  }

  const results = run.results as unknown as QueryRunResult[];
  if (!Array.isArray(results)) {
    throw new Error("Run has no results to import.");
  }

  const failuresGroupId = await ensureFailuresGroup(testId);

  const existingQueries = await prisma.workflowTestQuery.findMany({
    where: { groupId: failuresGroupId },
    select: { query: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });

  const toInsert = collectFailuresForImport(
    results,
    existingQueries.map((row) => row.query),
  );

  let nextSort =
    existingQueries.length > 0
      ? Math.max(...existingQueries.map((q) => q.sortOrder)) + 1
      : 0;

  let added = 0;
  const skipped = results.filter(
    (r) => r.status === "fail" || r.status === "error",
  ).length - toInsert.length;

  for (const item of toInsert) {
    await prisma.workflowTestQuery.create({
      data: {
        groupId: failuresGroupId,
        query: item.query,
        sortOrder: nextSort,
        sourceRunId: runId,
        sourceGroupName: item.groupName,
      },
    });
    nextSort += 1;
    added += 1;
  }

  const groups = await loadTestGroups(testId);
  return { groups, added, skipped };
}

export function getFailuresGroup(
  groups: WorkflowTestGroupRecord[],
): WorkflowTestGroupRecord | undefined {
  return groups.find((g) => g.kind === "failures");
}
