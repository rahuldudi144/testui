import {
  normalizeExecutionOverrides,
  parseCategoryType,
  type ExecutionPolicyOverrides,
  type WorkflowTestCategoryType,
} from "./workflowTestCategory.js";

export interface StressTestGroup {
  name: string;
  queries: string[];
  categoryType?: WorkflowTestCategoryType;
  execution?: ExecutionPolicyOverrides;
}

export type WorkflowTestGroupKind = "manual" | "failures";

export interface WorkflowTestFailureQuery {
  query: string;
  sourceGroupName?: string | null;
  sourceRunId?: string | null;
}

export interface WorkflowTestGroupRecord {
  id: string;
  name: string;
  kind: WorkflowTestGroupKind;
  sortOrder: number;
  queries: string[];
  categoryType: WorkflowTestCategoryType;
  executionOverrides: ExecutionPolicyOverrides | null;
  /** Present on failures groups (and any group with source metadata). */
  failureQueries?: WorkflowTestFailureQuery[];
}

export function parseQueries(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of text.split(/\n+/)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

/** Count configured entries without splitting commas inside a query. */
export function configuredEntryCount(queries: unknown): number {
  if (Array.isArray(queries)) {
    let count = 0;
    for (const entry of queries) {
      if (normalizeQueryEntry(entry)) count += 1;
    }
    return count;
  }
  if (typeof queries === "string") {
    return parseQueries(queries).length;
  }
  return 0;
}

function suiteQueryKey(groupName: string, query: string): string {
  return `${groupName}::${query.trim().replace(/\s+/g, " ")}`;
}

/**
 * Array suite entries are one query each. Reject empties and duplicate
 * `group::query` keys. Newline splitting stays in `parseQueries` for textarea
 * strings, which are not checked here.
 */
export function suiteImportError(
  groups: Array<{ name?: string; queries?: unknown }>,
): string | null {
  const seen = new Set<string>();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const name = group?.name?.trim();
    if (!name || !Array.isArray(group.queries)) continue;
    for (let n = 0; n < group.queries.length; n += 1) {
      const query = normalizeQueryEntry(group.queries[n]);
      if (!query) {
        return `groups[${i}] queries[${n}] is empty`;
      }
      const key = suiteQueryKey(name, query);
      if (seen.has(key)) {
        return `Duplicate queryKey ${key}`;
      }
      seen.add(key);
    }
  }
  return null;
}

export function assertPlannedMatchesConfigured(
  configured: number,
  planned: number,
): void {
  if (configured !== planned) {
    throw new Error(
      `Planned query count ${planned} does not match configured count ${configured}.`,
    );
  }
}

/** Normalize a query entry: plain string or `{ query: string }`. */
export function normalizeQueryEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed || null;
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const query = (entry as Record<string, unknown>).query;
    if (typeof query === "string") {
      const trimmed = query.trim();
      return trimmed || null;
    }
  }
  return null;
}

function parseExecutionOverrides(
  value: unknown,
): ExecutionPolicyOverrides | undefined {
  return normalizeExecutionOverrides(value) ?? undefined;
}

export function normalizeGroups(
  groups: Array<{
    name?: string;
    queries?: unknown;
    categoryType?: string;
    execution?: unknown;
  }>,
  options?: { keepEmpty?: boolean },
): StressTestGroup[] {
  const keepEmpty = options?.keepEmpty ?? false;
  const normalized: StressTestGroup[] = [];

  for (const group of groups) {
    const name = group.name?.trim();
    if (!name) continue;

    let queries: string[];
    if (Array.isArray(group.queries)) {
      queries = [];
      const seen = new Set<string>();
      for (const entry of group.queries) {
        const q = normalizeQueryEntry(entry);
        if (!q || seen.has(q)) continue;
        seen.add(q);
        queries.push(q);
      }
    } else if (typeof group.queries === "string") {
      queries = parseQueries(group.queries);
    } else {
      queries = [];
    }

    if (queries.length === 0 && !keepEmpty) continue;

    const categoryType = parseCategoryType(group.categoryType);
    const execution = parseExecutionOverrides(group.execution);

    normalized.push({
      name,
      queries,
      categoryType,
      ...(execution ? { execution } : {}),
    });
  }

  return normalized;
}

export function flattenGroups(groups: StressTestGroup[]): Array<{
  groupName: string;
  query: string;
}> {
  const items: Array<{ groupName: string; query: string }> = [];
  for (const group of groups) {
    for (const query of group.queries) {
      items.push({ groupName: group.name, query });
    }
  }
  return items;
}

export function flattenGroupRecords(
  groups: WorkflowTestGroupRecord[],
  groupIds?: string[],
): Array<{
  groupId: string;
  groupName: string;
  query: string;
  categoryType: WorkflowTestCategoryType;
  executionOverrides: ExecutionPolicyOverrides | null;
}> {
  const idSet = groupIds?.length ? new Set(groupIds) : null;
  const items: Array<{
    groupId: string;
    groupName: string;
    query: string;
    categoryType: WorkflowTestCategoryType;
    executionOverrides: ExecutionPolicyOverrides | null;
  }> = [];

  for (const group of groups) {
    if (idSet && !idSet.has(group.id)) continue;
    for (const query of group.queries) {
      items.push({
        groupId: group.id,
        groupName: group.name,
        query,
        categoryType: group.categoryType,
        executionOverrides: group.executionOverrides,
      });
    }
  }

  return items;
}
