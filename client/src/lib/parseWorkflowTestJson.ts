import type { StressTestGroupInput } from "./parseQueryGroups";
import { parseQueries } from "./parseQueryGroups";

export interface WorkflowTestJsonFile {
  testName: string;
  dryRun?: boolean;
  delayMs?: number;
  groups: Array<{
    name: string;
    queries: string[] | string;
  }>;
}

export interface ParsedWorkflowTestImport {
  testName: string;
  groups: StressTestGroupInput[];
  dryRun?: boolean;
  delayMs?: number;
}

export const WORKFLOW_TEST_JSON_EXAMPLE: WorkflowTestJsonFile = {
  testName: "Q1 regression — sales queries",
  dryRun: false,
  delayMs: 0,
  groups: [
    {
      name: "Aggregations",
      queries: [
        "Show total revenue by month",
        "What is the average order value?",
      ],
    },
    {
      name: "Joins",
      queries: [
        "List top 10 customers by total spend",
        "Show orders with customer names",
      ],
    },
    {
      name: "Edge cases",
      queries: "How many active users do we have?\nCount products with zero stock",
    },
  ],
};

function queriesToText(queries: string[] | string): string {
  if (Array.isArray(queries)) {
    return queries.map((q) => q.trim()).filter(Boolean).join("\n");
  }
  if (typeof queries === "string") return queries.trim();
  return "";
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

    const queriesRaw = groupRecord.queries;
    if (
      typeof queriesRaw !== "string" &&
      !(Array.isArray(queriesRaw) && queriesRaw.every((q) => typeof q === "string"))
    ) {
      return {
        ok: false,
        error: `groups[${i}].queries must be a string or array of strings.`,
      };
    }

    const queriesText = queriesToText(queriesRaw as string | string[]);
    if (parseQueries(queriesText).length === 0) {
      return { ok: false, error: `groups[${i}] has no valid queries.` };
    }

    groups.push({ name, queriesText });
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

  return { ok: true, data: { testName, groups, dryRun, delayMs } };
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
