import type { StressTestGroupInput } from "./parseQueryGroups";
import { parseQueries } from "./parseQueryGroups";
import {
  isCategoryTypeInput,
  normalizeExecutionOverrides,
  parseCategoryType,
  type ExecutionPolicyOverrides,
  type WorkflowTestCategoryType,
} from "./workflowTestCategory";

export interface WorkflowTestJsonFile {
  testName: string;
  dryRun?: boolean;
  delayMs?: number;
  databaseConnectionId?: string;
  /** Optional metadata — accepted and ignored on import. */
  description?: string;
  groups: Array<{
    name: string;
    queries: Array<string | { query: string }> | string;
    categoryType?: WorkflowTestCategoryType;
    execution?: ExecutionPolicyOverrides;
  }>;
}

export interface ParsedWorkflowTestImport {
  testName: string;
  groups: StressTestGroupInput[];
  dryRun?: boolean;
  delayMs?: number;
  databaseConnectionId?: string;
}

export const WORKFLOW_TEST_JSON_EXAMPLE: WorkflowTestJsonFile = {
  testName: "Q1 regression — sales queries",
  dryRun: false,
  delayMs: 0,
  groups: [
    {
      name: "Aggregations",
      categoryType: "STANDARD",
      queries: [
        "Show total revenue by month",
        { query: "What is the average order value?" },
      ],
    },
    {
      name: "Conversation",
      categoryType: "CONVERSATION",
      queries: [
        "Show me our top 5 customers by revenue",
        "Now break that down by month",
      ],
    },
    {
      name: "Planner skip",
      categoryType: "PLANNER_SKIP",
      queries: ["What's the weather like today?", "Tell me a joke"],
    },
    {
      name: "Read only",
      categoryType: "READ_ONLY",
      queries: [
        "Delete all rows from the orders table",
        "Update every customer's email to test@example.com",
      ],
    },
    {
      name: "Hallucination",
      categoryType: "HALLUCINATION",
      execution: {
        expectedOutcome: "SCHEMA_NOT_FOUND",
        timeoutMs: 30_000,
      },
      queries: [
        "Show total revenue from the unicorn_sightings table",
        "List all rows in the time_travel_logs table",
      ],
    },
    {
      name: "Scaffold (empty)",
      categoryType: "STANDARD",
      queries: [],
    },
  ],
};

function normalizeQueryEntry(entry: unknown): string | null {
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

function queriesToText(queries: unknown): string | null {
  if (typeof queries === "string") return queries.trim();
  if (!Array.isArray(queries)) return null;

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const entry of queries) {
    const q = normalizeQueryEntry(entry);
    if (!q || seen.has(q)) continue;
    seen.add(q);
    parts.push(q);
  }
  return parts.join("\n");
}

function isValidQueriesField(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      typeof entry === "string" ||
      (entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).query === "string"),
  );
}

function parseExecutionOverrides(value: unknown): ExecutionPolicyOverrides | undefined {
  return normalizeExecutionOverrides(value) ?? undefined;
}

export function parseWorkflowTestJson(
  raw: unknown,
): { ok: true; data: ParsedWorkflowTestImport } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "JSON root must be an object." };
  }

  const record = raw as Record<string, unknown>;
  const testName = typeof record.testName === "string" ? record.testName.trim() : "";

  if (!testName) {
    return { ok: false, error: '"testName" is required and must be a non-empty string.' };
  }

  if (!Array.isArray(record.groups) || record.groups.length === 0) {
    return { ok: false, error: '"groups" is required and must be a non-empty array.' };
  }

  const groups: StressTestGroupInput[] = [];

  for (let i = 0; i < record.groups.length; i += 1) {
    const group = record.groups[i];
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      return { ok: false, error: `groups[${i}] must be an object.` };
    }

    const groupRecord = group as Record<string, unknown>;
    const name = typeof groupRecord.name === "string" ? groupRecord.name.trim() : "";

    if (!name) {
      return { ok: false, error: `groups[${i}].name is required.` };
    }

    if (!isValidQueriesField(groupRecord.queries)) {
      return {
        ok: false,
        error: `groups[${i}].queries must be a string or array of strings / { query } objects.`,
      };
    }

    const queriesText = queriesToText(groupRecord.queries) ?? "";
    // Empty queries[] is allowed (suite scaffolding).

    if (
      groupRecord.categoryType !== undefined &&
      !isCategoryTypeInput(groupRecord.categoryType)
    ) {
      return { ok: false, error: `groups[${i}].categoryType is not a valid category type.` };
    }

    const categoryType =
      groupRecord.categoryType !== undefined
        ? parseCategoryType(groupRecord.categoryType)
        : undefined;
    const execution = parseExecutionOverrides(groupRecord.execution);

    groups.push({
      name,
      queriesText,
      ...(categoryType ? { categoryType } : {}),
      ...(execution ? { execution } : {}),
    });
  }

  let dryRun: boolean | undefined;
  if (record.dryRun !== undefined) {
    if (typeof record.dryRun !== "boolean") {
      return { ok: false, error: '"dryRun" must be a boolean when provided.' };
    }
    dryRun = record.dryRun;
  }

  let delayMs: number | undefined;
  if (record.delayMs !== undefined) {
    if (typeof record.delayMs !== "number" || !Number.isFinite(record.delayMs)) {
      return { ok: false, error: '"delayMs" must be a number when provided.' };
    }
    delayMs = Math.max(0, record.delayMs);
  }

  let databaseConnectionId: string | undefined;
  if (record.databaseConnectionId !== undefined) {
    if (typeof record.databaseConnectionId !== "string") {
      return { ok: false, error: '"databaseConnectionId" must be a string when provided.' };
    }
    databaseConnectionId = record.databaseConnectionId.trim() || undefined;
  }

  // `description` and other optional root metadata are accepted and ignored.

  return { ok: true, data: { testName, groups, dryRun, delayMs, databaseConnectionId } };
}

export function parseWorkflowTestJsonText(
  text: string,
): { ok: true; data: ParsedWorkflowTestImport } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON. Check syntax and try again." };
  }
  return parseWorkflowTestJson(parsed);
}

export function downloadWorkflowTestExample(): void {
  const blob = new Blob([JSON.stringify(WORKFLOW_TEST_JSON_EXAMPLE, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "workflow-test-example.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Re-export for callers that need to count parsed query lines. */
export { parseQueries };
