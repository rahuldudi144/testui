import { describe, expect, test } from "bun:test";
import {
  applyExecutionToAllGroups,
  applyExecutionToFailuresGroup,
  buildGlobalExecutionPatch,
  clearAllGroupExecutions,
  clearFailuresGroupExecution,
  EMPTY_GLOBAL_EXECUTION_DRAFT,
} from "../client/src/lib/applyGlobalExecutionOverrides.ts";
import type { StressTestGroupInput } from "../client/src/lib/parseQueryGroups.ts";

const sampleGroups: StressTestGroupInput[] = [
  {
    name: "A",
    queriesText: "q1",
    categoryType: "STANDARD",
    execution: { timeoutMs: 5000 },
  },
  {
    name: "B",
    queriesText: "q2",
    categoryType: "CONVERSATION",
    execution: { history: "KEEP" },
  },
];

describe("buildGlobalExecutionPatch", () => {
  test("returns null when no fields are set", () => {
    expect(buildGlobalExecutionPatch(EMPTY_GLOBAL_EXECUTION_DRAFT)).toBeNull();
  });

  test("includes only explicitly set fields", () => {
    expect(
      buildGlobalExecutionPatch({
        ...EMPTY_GLOBAL_EXECUTION_DRAFT,
        history: "RESET",
        timeoutMs: "30000",
      }),
    ).toEqual({
      history: "RESET",
      timeoutMs: 30000,
    });
  });

  test("includes stopOnFailure only when enabled", () => {
    expect(
      buildGlobalExecutionPatch({
        ...EMPTY_GLOBAL_EXECUTION_DRAFT,
        stopOnFailureEnabled: true,
        stopOnFailureValue: true,
      }),
    ).toEqual({ stopOnFailure: true });

    expect(
      buildGlobalExecutionPatch({
        ...EMPTY_GLOBAL_EXECUTION_DRAFT,
        stopOnFailureEnabled: false,
        stopOnFailureValue: true,
      }),
    ).toBeNull();
  });
});

describe("applyExecutionToAllGroups", () => {
  test("merges history into every group without dropping other keys", () => {
    const result = applyExecutionToAllGroups(sampleGroups, { history: "RESET" });
    expect(result[0]?.execution).toEqual({ timeoutMs: 5000, history: "RESET" });
    expect(result[1]?.execution).toEqual({ history: "RESET" });
  });

  test("applies multiple fields", () => {
    const result = applyExecutionToAllGroups(sampleGroups, {
      expectedOutcome: "CLARIFICATION",
      stopOnFailure: true,
    });
    expect(result[0]?.execution).toEqual({
      timeoutMs: 5000,
      expectedOutcome: "CLARIFICATION",
      stopOnFailure: true,
    });
    expect(result[1]?.execution).toEqual({
      history: "KEEP",
      expectedOutcome: "CLARIFICATION",
      stopOnFailure: true,
    });
  });
});

describe("clearAllGroupExecutions", () => {
  test("removes execution from all groups", () => {
    const result = clearAllGroupExecutions(sampleGroups);
    expect(result[0]?.execution).toBeUndefined();
    expect(result[1]?.execution).toBeUndefined();
    expect(result[0]?.name).toBe("A");
    expect(result[1]?.queriesText).toBe("q2");
  });
});

describe("applyExecutionToFailuresGroup", () => {
  test("merges global patch into failures group overrides", () => {
    const group = {
      id: "f1",
      name: "Failed queries",
      kind: "failures" as const,
      sortOrder: 0,
      queries: ["q"],
      executionOverrides: { timeoutMs: 1000 },
    };
    const next = applyExecutionToFailuresGroup(group, {
      history: "KEEP",
      stopOnFailure: true,
    });
    expect(next.executionOverrides).toEqual({
      timeoutMs: 1000,
      history: "KEEP",
      stopOnFailure: true,
    });
  });
});

describe("clearFailuresGroupExecution", () => {
  test("clears failures overrides", () => {
    const group = {
      id: "f1",
      name: "Failed queries",
      kind: "failures" as const,
      sortOrder: 0,
      queries: ["q"],
      executionOverrides: { history: "KEEP" as const },
    };
    expect(clearFailuresGroupExecution(group).executionOverrides).toBeNull();
  });
});
