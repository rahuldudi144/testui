import { describe, expect, test } from "bun:test";
import {
  expectedOutcomeToAgentOutcome,
  normalizeExecutionOverrides,
  normalizeExpectedOutcome,
  normalizeHistory,
  resolveExecution,
  scoreAgainstExpected,
  parseCategoryType,
} from "./workflowTestCategory.js";
import {
  estimateRemainingMs,
  estimateTotalMs,
  formatDurationEstimate,
  resolveAvgQueryMs,
  DEFAULT_AVG_QUERY_MS,
} from "./workflowTestEta.js";
import { normalizeGroups } from "./parseStressQueries.js";
import { buildStressTestSummary } from "./stressTestAnalyze.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

describe("resolveExecution", () => {
  test("STANDARD defaults", () => {
    expect(resolveExecution("STANDARD")).toEqual({
      history: "RESET",
      expectedOutcome: "SUCCESS",
      stopOnFailure: false,
    });
  });

  test("CONVERSATION keeps history", () => {
    expect(resolveExecution("CONVERSATION").history).toBe("KEEP");
  });

  test("PLANNER_SKIP expects PLANNER_SKIP", () => {
    const policy = resolveExecution("PLANNER_SKIP");
    expect(policy.expectedOutcome).toBe("PLANNER_SKIP");
    expect(policy.history).toBe("RESET");
  });

  test("HALLUCINATION expects SCHEMA_NOT_FOUND", () => {
    expect(resolveExecution("HALLUCINATION").expectedOutcome).toBe(
      "SCHEMA_NOT_FOUND",
    );
  });

  test("READ_ONLY expects VALIDATION_FAILURE", () => {
    expect(resolveExecution("READ_ONLY").expectedOutcome).toBe(
      "VALIDATION_FAILURE",
    );
  });

  test("overrides merge on top of defaults", () => {
    const policy = resolveExecution("STRESS", {
      history: "KEEP",
      stopOnFailure: true,
      timeoutMs: 5000,
    });
    expect(policy.history).toBe("KEEP");
    expect(policy.stopOnFailure).toBe(true);
    expect(policy.timeoutMs).toBe(5000);
    expect(policy.expectedOutcome).toBe("SUCCESS");
  });

  test("legacy aliases still resolve", () => {
    const policy = resolveExecution("STANDARD", {
      history: "keep" as never,
      expectedResult: "planner_skip",
      executeSql: false,
      delayMs: 100,
    } as never);
    expect(policy.history).toBe("KEEP");
    expect(policy.expectedOutcome).toBe("PLANNER_SKIP");
    expect(policy).not.toHaveProperty("executeSql");
    expect(policy).not.toHaveProperty("delayMs");
  });

  test("unknown category falls back to STANDARD", () => {
    expect(parseCategoryType("nope")).toBe("STANDARD");
    expect(resolveExecution("nope").expectedOutcome).toBe("SUCCESS");
  });

  test("legacy NORMAL alias maps to STANDARD", () => {
    expect(parseCategoryType("NORMAL")).toBe("STANDARD");
    expect(resolveExecution("NORMAL")).toEqual(resolveExecution("STANDARD"));
  });
});

describe("normalize helpers", () => {
  test("normalizeHistory accepts upper and lower", () => {
    expect(normalizeHistory("RESET")).toBe("RESET");
    expect(normalizeHistory("keep")).toBe("KEEP");
    expect(normalizeHistory("nope")).toBeUndefined();
  });

  test("normalizeExpectedOutcome accepts aliases", () => {
    expect(normalizeExpectedOutcome("SUCCESS")).toBe("SUCCESS");
    expect(normalizeExpectedOutcome("schema_not_found")).toBe("SCHEMA_NOT_FOUND");
    expect(normalizeExpectedOutcome("HALLUCINATION")).toBe("SCHEMA_NOT_FOUND");
  });

  test("normalizeExecutionOverrides ignores executeSql", () => {
    expect(
      normalizeExecutionOverrides({
        history: "KEEP",
        expectedOutcome: "SUCCESS",
        executeSql: false,
        timeoutMs: 1000,
      }),
    ).toEqual({
      history: "KEEP",
      expectedOutcome: "SUCCESS",
      timeoutMs: 1000,
    });
  });

  test("expectedOutcomeToAgentOutcome lowercases", () => {
    expect(expectedOutcomeToAgentOutcome("PLANNER_SKIP")).toBe("planner_skip");
  });
});

describe("scoreAgainstExpected", () => {
  test("pass when outcomes match", () => {
    expect(
      scoreAgainstExpected({
        expectedOutcome: "PLANNER_SKIP",
        actualOutcome: "planner_skip",
      }),
    ).toBe("pass");
  });

  test("fail when outcomes differ", () => {
    expect(
      scoreAgainstExpected({
        expectedOutcome: "SUCCESS",
        actualOutcome: "planner_skip",
      }),
    ).toBe("fail");
  });

  test("error when agent threw", () => {
    expect(
      scoreAgainstExpected({
        expectedOutcome: "SUCCESS",
        actualOutcome: "success",
        errored: true,
      }),
    ).toBe("error");
  });

  test("legacy expectedResult still scores", () => {
    expect(
      scoreAgainstExpected({
        expectedResult: "planner_skip",
        actualOutcome: "planner_skip",
      }),
    ).toBe("pass");
  });
});

describe("normalizeGroups category fields", () => {
  test("parses categoryType and execution", () => {
    const groups = normalizeGroups([
      {
        name: "Skip",
        categoryType: "PLANNER_SKIP",
        execution: { stopOnFailure: true, history: "KEEP" },
        queries: ["Tell me a joke"],
      },
    ]);
    expect(groups[0]?.categoryType).toBe("PLANNER_SKIP");
    expect(groups[0]?.execution?.stopOnFailure).toBe(true);
    expect(groups[0]?.execution?.history).toBe("KEEP");
  });

  test("accepts query objects", () => {
    const groups = normalizeGroups([
      {
        name: "Objects",
        queries: [{ query: "Show farmers" }, "List crops"],
      },
    ]);
    expect(groups[0]?.queries).toEqual(["Show farmers", "List crops"]);
  });

  test("keepEmpty preserves scaffold groups", () => {
    const groups = normalizeGroups(
      [{ name: "Empty", queries: [], categoryType: "STANDARD" }],
      { keepEmpty: true },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.queries).toEqual([]);
  });
});

describe("workflowTestEta", () => {
  test("estimateTotalMs includes delays between queries", () => {
    expect(
      estimateTotalMs({ queryCount: 3, avgQueryMs: 10_000, delayMs: 1000 }),
    ).toBe(32_000);
  });

  test("estimateRemainingMs", () => {
    expect(
      estimateRemainingMs({
        remainingQueries: 2,
        rollingAvgMs: 5000,
        delayMs: 500,
      }),
    ).toBe(10_500);
  });

  test("resolveAvgQueryMs uses last run when enough samples", () => {
    expect(
      resolveAvgQueryMs({
        lastRunDurations: [1000, 3000, 5000],
        suiteDurations: [],
      }),
    ).toBe(3000);
  });

  test("resolveAvgQueryMs falls back to default", () => {
    expect(resolveAvgQueryMs({ lastRunDurations: [1, 2] })).toBe(
      DEFAULT_AVG_QUERY_MS,
    );
  });

  test("formatDurationEstimate", () => {
    expect(formatDurationEstimate(45_000)).toBe("~45s");
    expect(formatDurationEstimate(125_000)).toBe("~2m 5s");
  });
});

describe("buildStressTestSummary category/outcome counts", () => {
  function baseResult(
    overrides: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "groupName">,
  ): QueryRunResult {
    return {
      status: "pass",
      failurePhase: "none",
      durationMs: 10,
      ...overrides,
    };
  }

  test("includes byCategory and outcome matched/mismatched", () => {
    const summary = buildStressTestSummary([
      baseResult({
        groupName: "g1",
        query: "ok",
        categoryType: "STANDARD",
        expectedOutcome: "SUCCESS",
        actualOutcome: "success",
        status: "pass",
      }),
      baseResult({
        groupName: "g1",
        query: "skip miss",
        categoryType: "PLANNER_SKIP",
        expectedOutcome: "PLANNER_SKIP",
        actualOutcome: "success",
        status: "fail",
      }),
      baseResult({
        groupName: "g2",
        query: "boom",
        categoryType: "STANDARD",
        expectedOutcome: "SUCCESS",
        actualOutcome: undefined,
        status: "error",
      }),
    ]);

    expect(summary.byCategory?.STANDARD).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      errors: 1,
      plannerSkipped: 0,
    });
    expect(summary.byCategory?.PLANNER_SKIP).toEqual({
      total: 1,
      passed: 0,
      failed: 1,
      errors: 0,
      plannerSkipped: 0,
    });
    expect(summary.outcomeMatched).toBe(1);
    expect(summary.outcomeMismatched).toBe(1);
    expect(summary.errors).toBe(1);
  });
});
