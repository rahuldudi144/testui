import { describe, expect, test } from "bun:test";
import {
  augmentSummaryWithObservability,
  buildQueryKey,
  collectFailedForRerun,
  mergeRerunAttempt,
  mergeRerunResults,
  normalizeQueryRunResult,
} from "./workflowTestObservability.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

function makeResult(
  partial: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "status">,
): QueryRunResult {
  return {
    groupName: "Group A",
    failurePhase: "none",
    durationMs: 100,
    ...partial,
  };
}

describe("buildQueryKey", () => {
  test("combines group and normalized query", () => {
    expect(buildQueryKey("Sales", "  show orders  ")).toBe(
      "Sales::show orders",
    );
  });
});

describe("normalizeQueryRunResult", () => {
  test("wraps legacy flat result as single attempt", () => {
    const legacy = makeResult({ query: "count users", status: "pass" });
    const normalized = normalizeQueryRunResult(legacy);

    expect(normalized.queryKey).toBe("Group A::count users");
    expect(normalized.attempts).toHaveLength(1);
    expect(normalized.attempts?.[0]?.attemptNumber).toBe(1);
    expect(normalized.attempts?.[0]?.kind).toBe("initial");
    expect(normalized.attempts?.[0]?.status).toBe("pass");
    expect(normalized.executionCount).toBe(1);
  });
});

describe("collectFailedForRerun", () => {
  test("selects only fail and error statuses", () => {
    const results = [
      makeResult({ query: "a", status: "pass" }),
      makeResult({ query: "b", status: "fail" }),
      makeResult({ query: "c", status: "error" }),
      makeResult({ query: "d", status: "planner_skip" }),
    ];

    const failed = collectFailedForRerun(results);
    expect(failed.map((r) => r.query)).toEqual(["b", "c"]);
  });
});

describe("mergeRerunAttempt", () => {
  test("appends rerun attempt and accumulates tokens", () => {
    const existing = normalizeQueryRunResult(
      enrichWithTokens(
        makeResult({ query: "retry me", status: "fail" }),
        100,
        50,
      ),
    );

    const rerun = makeResult({
      query: "retry me",
      status: "pass",
      durationMs: 80,
    });

    const merged = mergeRerunAttempt(
      existing,
      rerun,
      {
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
        llmCallCount: 3,
        llmCalls: [{ node: "planner", totalTokens: 280 }],
      },
      new Date("2025-07-01T12:00:00.000Z"),
    );

    expect(merged.status).toBe("pass");
    expect(merged.attempts).toHaveLength(2);
    expect(merged.attempts?.[1]?.kind).toBe("rerun");
    expect(merged.promptTokens).toBe(300);
    expect(merged.completionTokens).toBe(130);
    expect(merged.totalTokens).toBe(430);
    expect(merged.executionCount).toBe(2);
  });
});

describe("mergeRerunResults", () => {
  test("merges only matching query keys", () => {
    const existing = [
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "q1", status: "fail" }), 10, 5),
      ),
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "q2", status: "pass" }), 20, 10),
      ),
    ];

    const merged = mergeRerunResults(existing, [
      {
        queryKey: buildQueryKey("Group A", "q1"),
        result: makeResult({ query: "q1", status: "pass" }),
        metrics: {
          promptTokens: 15,
          completionTokens: 8,
          totalTokens: 23,
          llmCallCount: 1,
          llmCalls: [],
        },
        ranAt: new Date("2025-07-01T12:00:00.000Z"),
      },
    ]);

    expect(merged[0]?.status).toBe("pass");
    expect(merged[0]?.executionCount).toBe(2);
    expect(merged[1]?.executionCount).toBe(1);
  });
});

describe("augmentSummaryWithObservability", () => {
  test("sums execution and token totals from results", () => {
    const results = [
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "a", status: "pass" }), 100, 40),
      ),
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "b", status: "fail" }), 50, 20),
      ),
    ];

    const summary = augmentSummaryWithObservability(
      {
        total: 2,
        passed: 1,
        failed: 1,
        errors: 0,
        plannerSkipped: 0,
        byPhase: {},
        byGroup: {},
      },
      results,
    );

    expect(summary.executionCount).toBe(2);
    expect(summary.promptTokens).toBe(150);
    expect(summary.completionTokens).toBe(60);
    expect(summary.totalTokens).toBe(210);
  });
});

function enrichWithTokens(
  result: QueryRunResult,
  promptTokens: number,
  completionTokens: number,
): QueryRunResult {
  return {
    ...result,
    queryKey: buildQueryKey(result.groupName, result.query),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    executionCount: 1,
    attempts: [
      {
        attemptNumber: 1,
        kind: "initial",
        ranAt: new Date().toISOString(),
        status: result.status,
        durationMs: result.durationMs,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        llmCalls: [],
        failurePhase: result.failurePhase,
      },
    ],
  };
}
