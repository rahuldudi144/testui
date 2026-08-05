/**
 * Workflow test category types and execution policy defaults.
 *
 * Category supplies defaults; optional per-group `execution` overrides merge on top.
 * SQL execution is controlled by suite `dryRun` + agent workflow — not by category.
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

/** Uppercase expected terminal outcomes (map to AgentOutcome via expectedOutcomeToAgentOutcome). */
export type WorkflowExpectedOutcome =
  | "SUCCESS"
  | "PLANNER_SKIP"
  | "CLARIFICATION"
  | "VALIDATION_FAILURE"
  | "EXECUTION_FAILURE"
  | "SCHEMA_NOT_FOUND"
  | "RETRIEVAL_FAILURE";

export type WorkflowHistoryMode = "RESET" | "KEEP";

/** Per-group execution overrides (all optional). */
export interface WorkflowTestExecution {
  history?: WorkflowHistoryMode;
  expectedOutcome?: WorkflowExpectedOutcome;
  timeoutMs?: number;
  stopOnFailure?: boolean;
}

/** Alias kept for call sites that still import ExecutionPolicyOverrides. */
export type ExecutionPolicyOverrides = WorkflowTestExecution;

/** Resolved policy after category defaults + overrides. */
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

/** True for canonical types or the legacy alias `NORMAL` → STANDARD. */
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
  // Legacy lowercase AgentOutcome-style values
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

/** Map workflow expected outcome to AgentOutcome string for scoring. */
export function expectedOutcomeToAgentOutcome(
  expected: WorkflowExpectedOutcome,
): string {
  return expected.toLowerCase();
}

/**
 * Normalize a raw execution / executionOverrides object (new or legacy shape).
 * Ignores executeSql and delayMs.
 */
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

/** Merge category defaults with optional overrides. */
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

/**
 * When Setup sends execution overrides for a same-report failures rerun,
 * resolve policy from those overrides; otherwise keep the original result fields.
 */
export function resolveRerunItemPolicy(
  item: {
    categoryType?: string | null;
    expectedOutcome?: string | null;
    history?: WorkflowHistoryMode;
    stopOnFailure?: boolean;
    timeoutMs?: number;
  },
  override?: {
    categoryType?: string | null;
    execution?: WorkflowTestExecution | null;
  } | null,
): {
  categoryType: WorkflowTestCategoryType;
  expectedOutcome: WorkflowExpectedOutcome;
  history: WorkflowHistoryMode;
  stopOnFailure: boolean;
  timeoutMs?: number;
} {
  if (override && override.execution !== undefined) {
    const categoryType = parseCategoryType(
      override.categoryType ?? item.categoryType ?? "STANDARD",
    );
    const policy = resolveExecution(categoryType, override.execution);
    return {
      categoryType,
      expectedOutcome: policy.expectedOutcome,
      history: policy.history,
      stopOnFailure: policy.stopOnFailure,
      timeoutMs: policy.timeoutMs,
    };
  }

  const categoryType = parseCategoryType(item.categoryType ?? "STANDARD");
  const expected =
    normalizeExpectedOutcome(item.expectedOutcome) ??
    CATEGORY_DEFAULTS[categoryType].expectedOutcome;
  return {
    categoryType,
    expectedOutcome: expected,
    history:
      item.history === "KEEP" || item.history === "RESET"
        ? item.history
        : CATEGORY_DEFAULTS[categoryType].history,
    stopOnFailure:
      typeof item.stopOnFailure === "boolean"
        ? item.stopOnFailure
        : CATEGORY_DEFAULTS[categoryType].stopOnFailure,
    timeoutMs:
      typeof item.timeoutMs === "number" && item.timeoutMs > 0
        ? item.timeoutMs
        : CATEGORY_DEFAULTS[categoryType].timeoutMs,
  };
}

/**
 * Score a query: PASS when actual AgentOutcome matches expected.
 * Thrown agent errors should be passed as actualOutcome undefined + errored true.
 */
export function scoreAgainstExpected(params: {
  expectedOutcome?: WorkflowExpectedOutcome;
  /** @deprecated use expectedOutcome */
  expectedResult?: string;
  actualOutcome?: string | null;
  errored?: boolean;
}): "pass" | "fail" | "error" {
  if (params.errored) return "error";
  if (!params.actualOutcome) return "fail";
  const expected =
    params.expectedOutcome ??
    normalizeExpectedOutcome(params.expectedResult) ??
    "SUCCESS";
  return params.actualOutcome === expectedOutcomeToAgentOutcome(expected)
    ? "pass"
    : "fail";
}

/** Map legacy stress statuses to AgentOutcome-like values when outcome is missing. */
export function legacyStatusToOutcome(
  status: string | undefined,
): string | undefined {
  if (!status) return undefined;
  if (status === "pass") return "success";
  if (status === "planner_skip") return "planner_skip";
  if (status === "fail") return "validation_failure";
  if (status === "error") return undefined;
  return status;
}

/** @deprecated Use WorkflowExpectedOutcome */
export type WorkflowExpectedResult = WorkflowExpectedOutcome;
