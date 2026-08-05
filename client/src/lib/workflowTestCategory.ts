/**
 * Client mirror of server/workflowTestCategory.ts.
 * Keep in sync with the server file — the client can't import server code directly.
 */

export type WorkflowTestCategoryType =
  | "STANDARD"
  | "CONVERSATION"
  | "PLANNER_SKIP"
  | "CLARIFICATION"
  | "READ_ONLY"
  | "HALLUCINATION"
  | "EXECUTION_ERROR"
  | "STRESS";

export type WorkflowExpectedOutcome =
  | "SUCCESS"
  | "PLANNER_SKIP"
  | "CLARIFICATION"
  | "VALIDATION_FAILURE"
  | "EXECUTION_FAILURE"
  | "SCHEMA_NOT_FOUND"
  | "RETRIEVAL_FAILURE";

export type WorkflowHistoryMode = "RESET" | "KEEP";

export interface WorkflowTestExecution {
  history?: WorkflowHistoryMode;
  expectedOutcome?: WorkflowExpectedOutcome;
  timeoutMs?: number;
  stopOnFailure?: boolean;
}

export type ExecutionPolicyOverrides = WorkflowTestExecution;

export interface ResolvedExecution {
  history: WorkflowHistoryMode;
  expectedOutcome: WorkflowExpectedOutcome;
  stopOnFailure: boolean;
  timeoutMs?: number;
}

/** @deprecated Use ResolvedExecution */
export type ExecutionPolicy = ResolvedExecution;

export const CATEGORY_TYPES: WorkflowTestCategoryType[] = [
  "STANDARD",
  "CONVERSATION",
  "PLANNER_SKIP",
  "CLARIFICATION",
  "READ_ONLY",
  "HALLUCINATION",
  "EXECUTION_ERROR",
  "STRESS",
];

export const EXPECTED_OUTCOMES: WorkflowExpectedOutcome[] = [
  "SUCCESS",
  "PLANNER_SKIP",
  "CLARIFICATION",
  "VALIDATION_FAILURE",
  "EXECUTION_FAILURE",
  "SCHEMA_NOT_FOUND",
  "RETRIEVAL_FAILURE",
];

export const CATEGORY_TYPE_LABELS: Record<WorkflowTestCategoryType, string> = {
  STANDARD: "Standard",
  CONVERSATION: "Conversation",
  PLANNER_SKIP: "Planner skip",
  CLARIFICATION: "Clarification",
  READ_ONLY: "Read only",
  HALLUCINATION: "Hallucination",
  EXECUTION_ERROR: "Execution error",
  STRESS: "Stress",
};

export const EXPECTED_OUTCOME_LABELS: Record<WorkflowExpectedOutcome, string> = {
  SUCCESS: "Success",
  PLANNER_SKIP: "Planner skip",
  CLARIFICATION: "Clarification",
  VALIDATION_FAILURE: "Validation failure",
  EXECUTION_FAILURE: "Execution failure",
  SCHEMA_NOT_FOUND: "Schema not found",
  RETRIEVAL_FAILURE: "Retrieval failure",
};

const CATEGORY_DEFAULTS: Record<WorkflowTestCategoryType, ResolvedExecution> = {
  STANDARD: {
    history: "RESET",
    expectedOutcome: "SUCCESS",
    stopOnFailure: false,
  },
  CONVERSATION: {
    history: "KEEP",
    expectedOutcome: "SUCCESS",
    stopOnFailure: false,
  },
  PLANNER_SKIP: {
    history: "RESET",
    expectedOutcome: "PLANNER_SKIP",
    stopOnFailure: false,
  },
  CLARIFICATION: {
    history: "RESET",
    expectedOutcome: "CLARIFICATION",
    stopOnFailure: false,
  },
  READ_ONLY: {
    history: "RESET",
    expectedOutcome: "VALIDATION_FAILURE",
    stopOnFailure: false,
  },
  HALLUCINATION: {
    history: "RESET",
    expectedOutcome: "SCHEMA_NOT_FOUND",
    stopOnFailure: false,
  },
  EXECUTION_ERROR: {
    history: "RESET",
    expectedOutcome: "EXECUTION_FAILURE",
    stopOnFailure: false,
  },
  STRESS: {
    history: "RESET",
    expectedOutcome: "SUCCESS",
    stopOnFailure: false,
  },
};

export function isCategoryType(value: unknown): value is WorkflowTestCategoryType {
  return (
    typeof value === "string" &&
    (CATEGORY_TYPES as string[]).includes(value)
  );
}

export function isCategoryTypeInput(value: unknown): boolean {
  return value === "NORMAL" || isCategoryType(value);
}

export function parseCategoryType(
  value: unknown,
  fallback: WorkflowTestCategoryType = "STANDARD",
): WorkflowTestCategoryType {
  if (value === "NORMAL") return "STANDARD";
  return isCategoryType(value) ? value : fallback;
}

export function normalizeHistory(value: unknown): WorkflowHistoryMode | undefined {
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === "RESET" || upper === "KEEP") return upper;
  return undefined;
}

export function normalizeExpectedOutcome(
  value: unknown,
): WorkflowExpectedOutcome | undefined {
  if (typeof value !== "string") return undefined;
  const upper = value.trim().toUpperCase();
  if ((EXPECTED_OUTCOMES as string[]).includes(upper)) {
    return upper as WorkflowExpectedOutcome;
  }
  if (upper === "HALLUCINATION") return "SCHEMA_NOT_FOUND";
  const legacy: Record<string, WorkflowExpectedOutcome> = {
    success: "SUCCESS",
    planner_skip: "PLANNER_SKIP",
    clarification: "CLARIFICATION",
    validation_failure: "VALIDATION_FAILURE",
    execution_failure: "EXECUTION_FAILURE",
    schema_not_found: "SCHEMA_NOT_FOUND",
    retrieval_failure: "RETRIEVAL_FAILURE",
  };
  return legacy[value.trim().toLowerCase()];
}

export function expectedOutcomeToAgentOutcome(
  expected: WorkflowExpectedOutcome,
): string {
  return expected.toLowerCase();
}

export function normalizeExecutionOverrides(
  raw: unknown,
): WorkflowTestExecution | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const out: WorkflowTestExecution = {};

  const history = normalizeHistory(record.history);
  if (history) out.history = history;

  const expected =
    normalizeExpectedOutcome(record.expectedOutcome) ??
    normalizeExpectedOutcome(record.expected) ??
    normalizeExpectedOutcome(record.expectedResult);
  if (expected) out.expectedOutcome = expected;

  if (typeof record.stopOnFailure === "boolean") {
    out.stopOnFailure = record.stopOnFailure;
  }
  if (
    typeof record.timeoutMs === "number" &&
    Number.isFinite(record.timeoutMs) &&
    record.timeoutMs > 0
  ) {
    out.timeoutMs = Math.floor(record.timeoutMs);
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function resolveExecution(
  categoryType: WorkflowTestCategoryType | string | null | undefined,
  overrides?: WorkflowTestExecution | null,
): ResolvedExecution {
  const type = parseCategoryType(categoryType);
  const base = { ...CATEGORY_DEFAULTS[type] };
  const normalized =
    overrides && typeof overrides === "object"
      ? normalizeExecutionOverrides(overrides) ?? overrides
      : null;
  if (!normalized) return base;

  if (normalized.history === "RESET" || normalized.history === "KEEP") {
    base.history = normalized.history;
  }
  if (normalized.expectedOutcome) {
    const expected = normalizeExpectedOutcome(normalized.expectedOutcome);
    if (expected) base.expectedOutcome = expected;
  }
  if (typeof normalized.stopOnFailure === "boolean") {
    base.stopOnFailure = normalized.stopOnFailure;
  }
  if (
    typeof normalized.timeoutMs === "number" &&
    Number.isFinite(normalized.timeoutMs) &&
    normalized.timeoutMs > 0
  ) {
    base.timeoutMs = Math.floor(normalized.timeoutMs);
  }

  return base;
}

/** @deprecated Use WorkflowExpectedOutcome */
export type WorkflowExpectedResult = WorkflowExpectedOutcome;
