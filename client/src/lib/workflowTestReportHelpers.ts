import {
  CATEGORY_TYPE_LABELS,
  EXPECTED_OUTCOME_LABELS,
  expectedOutcomeToAgentOutcome,
  normalizeExpectedOutcome,
  type WorkflowExpectedOutcome,
  type WorkflowTestCategoryType,
} from "./workflowTestCategory";

export function formatOutcomeLabel(outcome: string | undefined | null): string {
  if (!outcome) return "—";
  const normalized = normalizeExpectedOutcome(outcome);
  if (normalized && EXPECTED_OUTCOME_LABELS[normalized]) {
    return EXPECTED_OUTCOME_LABELS[normalized];
  }
  return outcome.replace(/_/g, " ").toLowerCase();
}

export function outcomesMatch(
  expectedOutcome?: string | null,
  actualOutcome?: string | null,
): boolean {
  if (!expectedOutcome || !actualOutcome) return false;
  const expected =
    normalizeExpectedOutcome(expectedOutcome) ??
    (expectedOutcome.toUpperCase() as WorkflowExpectedOutcome);
  return actualOutcome === expectedOutcomeToAgentOutcome(expected);
}

export function categoryTypeLabel(
  categoryType?: string | null,
): string {
  if (!categoryType) return "Standard";
  if (categoryType in CATEGORY_TYPE_LABELS) {
    return CATEGORY_TYPE_LABELS[categoryType as WorkflowTestCategoryType];
  }
  return categoryType;
}

export function isFatalAbortMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("run stopped:") ||
    lower.includes("authentication failed") ||
    lower.includes("insufficient tokens") ||
    lower.includes("billing issue") ||
    lower.includes("rate limit exceeded") ||
    lower.includes("(401)") ||
    lower.includes("(402)") ||
    lower.includes("(429)")
  );
}

/** Upsert one query result into an existing report and refresh pass/fail counts. */
export function mergeQueryResultIntoReport<
  T extends {
    results: Array<{
      queryKey?: string;
      groupName: string;
      query: string;
      status: string;
    }>;
    summary: {
      total: number;
      passed: number;
      failed: number;
      errors: number;
      plannerSkipped: number;
    };
  },
>(
  report: T,
  result: T["results"][number],
  resultKey: (row: T["results"][number]) => string,
): T {
  const key = resultKey(result);
  const results = report.results.map((row) =>
    resultKey(row) === key ? result : row,
  );
  const hasKey = report.results.some((row) => resultKey(row) === key);
  const nextResults = hasKey ? results : [...results, result];

  let passed = 0;
  let failed = 0;
  let errors = 0;
  let plannerSkipped = 0;
  for (const row of nextResults) {
    if (row.status === "pass") passed += 1;
    else if (row.status === "fail") failed += 1;
    else if (row.status === "error") errors += 1;
    else if (row.status === "planner_skip") plannerSkipped += 1;
  }

  return {
    ...report,
    results: nextResults,
    summary: {
      ...report.summary,
      total: nextResults.length,
      passed,
      failed,
      errors,
      plannerSkipped,
    },
  };
}
