import type { StressTestGroupInput } from "./parseQueryGroups";
import type {
  ExecutionPolicyOverrides,
  WorkflowExpectedOutcome,
  WorkflowHistoryMode,
} from "./workflowTestCategory";

export interface GlobalExecutionPatch {
  history?: WorkflowHistoryMode;
  expectedOutcome?: WorkflowExpectedOutcome;
  timeoutMs?: number;
  stopOnFailure?: boolean;
}

export interface GlobalExecutionDraft {
  history: "" | WorkflowHistoryMode;
  expectedOutcome: "" | WorkflowExpectedOutcome;
  timeoutMs: string;
  stopOnFailureEnabled: boolean;
  stopOnFailureValue: boolean;
}

export const EMPTY_GLOBAL_EXECUTION_DRAFT: GlobalExecutionDraft = {
  history: "",
  expectedOutcome: "",
  timeoutMs: "",
  stopOnFailureEnabled: false,
  stopOnFailureValue: false,
};

export function buildGlobalExecutionPatch(
  draft: GlobalExecutionDraft,
): GlobalExecutionPatch | null {
  const patch: GlobalExecutionPatch = {};

  if (draft.history === "RESET" || draft.history === "KEEP") {
    patch.history = draft.history;
  }

  if (draft.expectedOutcome) {
    patch.expectedOutcome = draft.expectedOutcome;
  }

  const timeoutTrimmed = draft.timeoutMs.trim();
  if (timeoutTrimmed !== "") {
    const parsed = Number(timeoutTrimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      patch.timeoutMs = Math.floor(parsed);
    }
  }

  if (draft.stopOnFailureEnabled) {
    patch.stopOnFailure = draft.stopOnFailureValue;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function applyExecutionToAllGroups(
  groups: StressTestGroupInput[],
  patch: GlobalExecutionPatch,
): StressTestGroupInput[] {
  return groups.map((group) => ({
    ...group,
    execution: mergeExecutionOverrides(group.execution, patch),
  }));
}

export function clearAllGroupExecutions(
  groups: StressTestGroupInput[],
): StressTestGroupInput[] {
  return groups.map((group) => ({ ...group, execution: undefined }));
}

export function applyExecutionToFailuresGroup<
  T extends { executionOverrides?: ExecutionPolicyOverrides | null },
>(group: T, patch: GlobalExecutionPatch): T {
  return {
    ...group,
    executionOverrides: mergeExecutionOverrides(
      group.executionOverrides ?? undefined,
      patch,
    ),
  };
}

export function clearFailuresGroupExecution<
  T extends { executionOverrides?: ExecutionPolicyOverrides | null },
>(group: T): T {
  return { ...group, executionOverrides: null };
}

function mergeExecutionOverrides(
  existing: ExecutionPolicyOverrides | undefined,
  patch: GlobalExecutionPatch,
): ExecutionPolicyOverrides {
  return { ...existing, ...patch };
}
