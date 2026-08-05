import type { Prisma, WorkflowTestGroupKind } from "@prisma/client";
import { prisma } from "./db.js";
import type {
  WorkflowTestFailureQuery,
  WorkflowTestGroupRecord,
} from "./parseStressQueries.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";
import {
  normalizeExecutionOverrides,
  parseCategoryType,
  type ExecutionPolicyOverrides,
  type WorkflowTestCategoryType,
} from "./workflowTestCategory.js";

export const FAILURES_GROUP_NAME = "Failed queries";
export const FAILURES_GROUP_SORT_ORDER = 9999;

export function normalizeQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function isDefaultFailuresGroupName(name: string | undefined | null): boolean {
  const trimmed = name?.trim() ?? "";
  return (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === FAILURES_GROUP_NAME.toLowerCase()
  );
}

export function collectFailuresForImport(
  results: QueryRunResult[],
  existingQueries: string[],
): Array<{
  query: string;
  groupName: string;
  categoryType?: string;
}> {
  const existingKeys = new Set(
    existingQueries.map((query) => normalizeQueryKey(query)),
  );
  const collected: Array<{
    query: string;
    groupName: string;
    categoryType?: string;
  }> = [];

  for (const result of results) {
    if (result.status !== "fail" && result.status !== "error") continue;

    const key = normalizeQueryKey(result.query);
    if (!key || existingKeys.has(key)) continue;

    existingKeys.add(key);
    collected.push({
      query: result.query.trim(),
      groupName: result.groupName?.trim() || "Unknown",
      categoryType: result.categoryType,
    });
  }

  return collected;
}

/** Bucket fail/error rows by original group, preserving categoryType. */
export function groupFailuresBySourceForExport(
  failures: Array<{
    query: string;
    groupName: string;
    categoryType?: string;
  }>,
  parentGroups?: Array<{
    name: string;
    categoryType?: string;
    executionOverrides?: ExecutionPolicyOverrides | null;
  }>,
): Array<{
  groupName: string;
  categoryType: WorkflowTestCategoryType;
  executionOverrides: ExecutionPolicyOverrides | null;
  queries: string[];
}> {
  const parentByName = new Map(
    (parentGroups ?? []).map((group) => [
      group.name.trim().toLowerCase(),
      group,
    ]),
  );
  const order: string[] = [];
  const map = new Map<
    string,
    {
      groupName: string;
      categoryType: WorkflowTestCategoryType;
      executionOverrides: ExecutionPolicyOverrides | null;
      queries: string[];
    }
  >();

  for (const item of failures) {
    const groupName = item.groupName.trim() || "Unknown";
    const key = groupName.toLowerCase();
    const parent = parentByName.get(key);
    let bucket = map.get(key);
    if (!bucket) {
      order.push(key);
      bucket = {
        groupName,
        categoryType: parseCategoryType(
          item.categoryType ?? parent?.categoryType ?? "STANDARD",
        ),
        executionOverrides: parent?.executionOverrides ?? null,
        queries: [],
      };
      map.set(key, bucket);
    }
    bucket.queries.push(item.query);
  }

  return order.map((key) => map.get(key)!);
}

function parseOverridesJson(
  value: unknown,
): ExecutionPolicyOverrides | null {
  return normalizeExecutionOverrides(value);
}

function toGroupRecord(row: {
  id: string;
  name: string;
  kind: WorkflowTestGroupKind;
  sortOrder: number;
  categoryType?: string | null;
  executionOverrides?: unknown;
  queries: Array<{
    query: string;
    sourceGroupName?: string | null;
    sourceRunId?: string | null;
  }>;
}): WorkflowTestGroupRecord {
  const failureQueries: WorkflowTestFailureQuery[] = row.queries.map((q) => ({
    query: q.query,
    sourceGroupName: q.sourceGroupName ?? null,
    sourceRunId: q.sourceRunId ?? null,
  }));
  const hasSourceMeta = failureQueries.some(
    (q) => q.sourceGroupName || q.sourceRunId,
  );

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sortOrder: row.sortOrder,
    queries: row.queries.map((q) => q.query),
    categoryType: parseCategoryType(row.categoryType),
    executionOverrides: parseOverridesJson(row.executionOverrides),
    ...(row.kind === "failures" || hasSourceMeta ? { failureQueries } : {}),
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
      categoryType: "STANDARD",
      sortOrder: FAILURES_GROUP_SORT_ORDER,
    },
  });
  return created.id;
}

async function ensureNamedManualGroup(
  testId: string,
  name: string,
  options?: {
    categoryType?: WorkflowTestCategoryType | string;
    executionOverrides?: ExecutionPolicyOverrides | null;
  },
): Promise<string> {
  const trimmed = name.trim();
  const categoryType = parseCategoryType(options?.categoryType ?? "STANDARD");
  const overrides = normalizeExecutionOverrides(
    options?.executionOverrides ?? null,
  );
  const existing = await prisma.workflowTestGroup.findFirst({
    where: {
      workflowTestId: testId,
      kind: "manual",
      name: trimmed,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.workflowTestGroup.update({
      where: { id: existing.id },
      data: {
        categoryType,
        executionOverrides:
          overrides && Object.keys(overrides).length > 0
            ? (overrides as Prisma.InputJsonValue)
            : undefined,
      },
    });
    return existing.id;
  }

  const maxSort = await prisma.workflowTestGroup.aggregate({
    where: { workflowTestId: testId, kind: "manual" },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const created = await prisma.workflowTestGroup.create({
    data: {
      workflowTestId: testId,
      name: trimmed,
      kind: "manual",
      categoryType,
      executionOverrides:
        overrides && Object.keys(overrides).length > 0
          ? (overrides as Prisma.InputJsonValue)
          : undefined,
      sortOrder,
    },
  });
  return created.id;
}

export type ManualGroupInput = {
  name: string;
  queries: string[];
  categoryType?: WorkflowTestCategoryType | string;
  execution?: ExecutionPolicyOverrides | null;
};

/**
 * Keep failure-import manual groups that are missing from the form payload.
 * Prevents POST /run from wiping "Save failures to group" results when Setup
 * still has a stale groups list.
 */
export function mergeManualGroupsPreservingImported<
  T extends { name: string; hasImportedQueries: boolean },
>(incoming: ManualGroupInput[], existing: T[]): { incoming: ManualGroupInput[]; preserved: T[] } {
  const incomingNames = new Set(
    incoming.map((group) => group.name.trim().toLowerCase()),
  );
  const preserved = existing.filter(
    (group) =>
      group.hasImportedQueries &&
      group.name.trim().length > 0 &&
      !incomingNames.has(group.name.trim().toLowerCase()),
  );
  return { incoming, preserved };
}

export async function saveManualGroups(
  testId: string,
  manualGroups: ManualGroupInput[],
): Promise<WorkflowTestGroupRecord[]> {
  await ensureFailuresGroup(testId);

  const existing = await prisma.workflowTestGroup.findMany({
    where: { workflowTestId: testId, kind: "manual" },
    include: {
      queries: {
        select: {
          query: true,
          sourceRunId: true,
          sourceGroupName: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const { incoming, preserved } = mergeManualGroupsPreservingImported(
    manualGroups,
    existing.map((group) => ({
      name: group.name,
      categoryType: parseCategoryType(group.categoryType),
      execution: parseOverridesJson(group.executionOverrides),
      queries: group.queries,
      hasImportedQueries: group.queries.some((row) => Boolean(row.sourceRunId)),
    })),
  );

  const manualIds = existing.map((g) => g.id);

  if (manualIds.length > 0) {
    await prisma.workflowTestGroup.deleteMany({
      where: { id: { in: manualIds } },
    });
  }

  let sortOrder = 0;
  for (const group of incoming) {
    const categoryType = parseCategoryType(group.categoryType);
    const overrides = normalizeExecutionOverrides(group.execution);
    const matchedExisting = existing.find(
      (row) => row.name.trim().toLowerCase() === group.name.trim().toLowerCase(),
    );
    const existingQueriesByText = new Map(
      (matchedExisting?.queries ?? []).map((row) => [
        row.query.trim().replace(/\s+/g, " ").toLowerCase(),
        row,
      ]),
    );
    await prisma.workflowTestGroup.create({
      data: {
        workflowTestId: testId,
        name: group.name,
        kind: "manual",
        categoryType,
        executionOverrides:
          overrides && Object.keys(overrides).length > 0
            ? (overrides as Prisma.InputJsonValue)
            : undefined,
        sortOrder,
        queries: {
          create: group.queries.map((query, queryIndex) => {
            const prior = existingQueriesByText.get(
              query.trim().replace(/\s+/g, " ").toLowerCase(),
            );
            return {
              query,
              sortOrder: queryIndex,
              sourceRunId: prior?.sourceRunId ?? undefined,
              sourceGroupName: prior?.sourceGroupName ?? undefined,
            };
          }),
        },
      },
    });
    sortOrder += 1;
  }

  for (const group of preserved) {
    const overrides = normalizeExecutionOverrides(group.execution);
    await prisma.workflowTestGroup.create({
      data: {
        workflowTestId: testId,
        name: group.name,
        kind: "manual",
        categoryType: parseCategoryType(group.categoryType),
        executionOverrides:
          overrides && Object.keys(overrides).length > 0
            ? (overrides as Prisma.InputJsonValue)
            : undefined,
        sortOrder,
        queries: {
          create: group.queries.map((row, queryIndex) => ({
            query: row.query,
            sortOrder: queryIndex,
            sourceRunId: row.sourceRunId ?? undefined,
            sourceGroupName: row.sourceGroupName ?? undefined,
          })),
        },
      },
    });
    sortOrder += 1;
  }

  return loadTestGroups(testId);
}

export async function updateFailuresGroupPolicy(
  testId: string,
  policy: {
    categoryType?: WorkflowTestCategoryType | string;
    executionOverrides?: ExecutionPolicyOverrides | null;
  },
): Promise<WorkflowTestGroupRecord[]> {
  const groupId = await ensureFailuresGroup(testId);
  const overrides = normalizeExecutionOverrides(policy.executionOverrides ?? null);
  await prisma.workflowTestGroup.update({
    where: { id: groupId },
    data: {
      ...(policy.categoryType !== undefined
        ? { categoryType: parseCategoryType(policy.categoryType) }
        : {}),
      executionOverrides:
        overrides && Object.keys(overrides).length > 0
          ? (overrides as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });
  return loadTestGroups(testId);
}

export interface ImportFailuresResult {
  /** New or existing standalone test that received the failures. */
  testId: string;
  testName: string;
  groups: WorkflowTestGroupRecord[];
  added: number;
  skipped: number;
  targetGroupId: string;
  targetGroupName: string;
  /** True when a new WorkflowTest row was created. */
  created: boolean;
}

export function resolveFailureExportTestName(
  parentTestName: string,
  groupName?: string | null,
): string {
  const trimmed = groupName?.trim() || "";
  return trimmed.length > 0 ? trimmed : `${parentTestName} — Failed queries`;
}

/**
 * Save fail/error queries from a run into a standalone workflow test that
 * appears in Tests — so it can be loaded/run with its own agent and settings.
 * Parent test is left unchanged.
 */
export async function importFailuresFromRun(
  testId: string,
  runId: string,
  userId: string,
  groupName?: string | null,
): Promise<ImportFailuresResult> {
  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, workflowTestId: testId, userId },
  });
  if (!run) {
    throw new Error("Workflow test run not found.");
  }

  const parent = await prisma.workflowTest.findFirst({
    where: { id: testId, userId },
  });
  if (!parent) {
    throw new Error("Workflow test not found.");
  }

  const results = run.results as unknown as QueryRunResult[];
  if (!Array.isArray(results)) {
    throw new Error("Run has no results to import.");
  }

  const trimmedName = groupName?.trim() || "";
  const testName = resolveFailureExportTestName(parent.name, trimmedName);

  const existingTest = await prisma.workflowTest.findFirst({
    where: {
      userId,
      name: testName,
      agentProfileId: parent.agentProfileId ?? null,
    },
  });

  let targetId: string;
  let created = false;
  if (existingTest) {
    targetId = existingTest.id;
    await prisma.workflowTest.update({
      where: { id: existingTest.id },
      data: {
        dryRun: parent.dryRun,
        delayMs: parent.delayMs,
        databaseConnectionId: parent.databaseConnectionId,
      },
    });
  } else {
    const createdTest = await prisma.workflowTest.create({
      data: {
        userId,
        name: testName,
        agentProfileId: parent.agentProfileId,
        databaseConnectionId: parent.databaseConnectionId,
        dryRun: parent.dryRun,
        delayMs: parent.delayMs,
        suiteKey: parent.suiteKey ?? parent.id,
      },
    });
    targetId = createdTest.id;
    created = true;
    if (!createdTest.suiteKey) {
      await prisma.workflowTest.update({
        where: { id: createdTest.id },
        data: { suiteKey: parent.suiteKey ?? parent.id },
      });
    }
  }

  await ensureFailuresGroup(targetId);

  const parentGroups = await loadTestGroups(testId);
  // Dedupe against all queries already on the target test (any group).
  const existingOnTarget = await prisma.workflowTestQuery.findMany({
    where: { group: { workflowTestId: targetId, kind: "manual" } },
    select: { query: true },
  });
  const toInsert = collectFailuresForImport(
    results,
    existingOnTarget.map((row) => row.query),
  );
  const grouped = groupFailuresBySourceForExport(
    toInsert,
    parentGroups
      .filter((group) => group.kind === "manual")
      .map((group) => ({
        name: group.name,
        categoryType: group.categoryType,
        executionOverrides: group.executionOverrides ?? null,
      })),
  );

  let added = 0;
  const skipped =
    results.filter((r) => r.status === "fail" || r.status === "error").length -
    toInsert.length;

  let firstGroupId = "";
  for (const bucket of grouped) {
    const groupId = await ensureNamedManualGroup(targetId, bucket.groupName, {
      categoryType: bucket.categoryType,
      executionOverrides: bucket.executionOverrides,
    });
    if (!firstGroupId) firstGroupId = groupId;

    const existingInGroup = await prisma.workflowTestQuery.findMany({
      where: { groupId },
      select: { sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    let nextSort =
      existingInGroup.length > 0
        ? Math.max(...existingInGroup.map((q) => q.sortOrder)) + 1
        : 0;

    for (const query of bucket.queries) {
      await prisma.workflowTestQuery.create({
        data: {
          groupId,
          query,
          sortOrder: nextSort,
          sourceRunId: runId,
          sourceGroupName: bucket.groupName,
        },
      });
      nextSort += 1;
      added += 1;
    }
  }

  const groups = await loadTestGroups(targetId);
  return {
    testId: targetId,
    testName,
    groups,
    added,
    skipped,
    targetGroupId: firstGroupId,
    targetGroupName:
      grouped.length === 1
        ? grouped[0]!.groupName
        : `${grouped.length} groups`,
    created,
  };
}

export function getFailuresGroup(
  groups: WorkflowTestGroupRecord[],
): WorkflowTestGroupRecord | undefined {
  return groups.find((g) => g.kind === "failures");
}
