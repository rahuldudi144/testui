import { describe, expect, test } from "bun:test";
import {
  augmentSummaryWithObservability,
  buildQueryKey,
  collectFailedForRerun,
  mergeRerunAttempt,
  mergeRerunResults,
  normalizeQueryRunResult,
  selectFailedItemsForRerun,
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

  test("keeps prior passes and reduces failures across progressive merges", () => {
    const existing = [
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "keep", status: "pass" }), 1, 1),
      ),
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "f1", status: "fail" }), 1, 1),
      ),
      normalizeQueryRunResult(
        enrichWithTokens(makeResult({ query: "f2", status: "error" }), 1, 1),
      ),
    ];

    const afterFirst = mergeRerunResults(existing, [
      {
        queryKey: buildQueryKey("Group A", "f1"),
        result: makeResult({ query: "f1", status: "pass" }),
        metrics: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          llmCallCount: 1,
          llmCalls: [],
        },
        ranAt: new Date("2025-07-01T12:00:00.000Z"),
      },
    ]);

    expect(afterFirst.map((row) => row.status)).toEqual([
      "pass",
      "pass",
      "error",
    ]);

    const afterCancel = mergeRerunResults(afterFirst, [
      {
        queryKey: buildQueryKey("Group A", "f2"),
        result: makeResult({ query: "f2", status: "pass" }),
        metrics: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          llmCallCount: 1,
          llmCalls: [],
        },
        ranAt: new Date("2025-07-01T12:01:00.000Z"),
      },
    ]);

    expect(afterCancel.every((row) => row.status === "pass")).toBe(true);
    expect(afterCancel[0]?.executionCount).toBe(1);
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

describe("selectFailedItemsForRerun", () => {
  test("returns all fail/error rows when groups are omitted", () => {
    const results = [
      normalizeQueryRunResult(makeResult({ query: "ok", status: "pass" })),
      normalizeQueryRunResult(
        makeResult({ query: "bad", status: "fail", categoryType: "STANDARD" }),
      ),
      normalizeQueryRunResult(
        makeResult({
          groupName: "B",
          query: "err",
          status: "error",
          categoryType: "CONVERSATION",
        }),
      ),
    ];

    const selected = selectFailedItemsForRerun(results);
    expect(selected).toHaveLength(2);
    expect(selected.map((row) => row.item.query)).toEqual(["bad", "err"]);
  });

  test("filters and applies Setup group category overrides", () => {
    const results = [
      normalizeQueryRunResult(
        makeResult({
          groupName: "Orders",
          query: "list orders",
          status: "fail",
          categoryType: "STANDARD",
        }),
      ),
      normalizeQueryRunResult(
        makeResult({
          groupName: "Orders",
          query: "count orders",
          status: "fail",
          categoryType: "STANDARD",
        }),
      ),
      normalizeQueryRunResult(
        makeResult({
          groupName: "Users",
          query: "list users",
          status: "error",
          categoryType: "STANDARD",
        }),
      ),
    ];

    const selected = selectFailedItemsForRerun(results, {
      groups: [
        {
          name: "Orders",
          queries: ["list orders"],
          categoryType: "CONVERSATION",
        },
      ],
    });

    expect(selected).toHaveLength(1);
    expect(selected[0]?.item.query).toBe("list orders");
    expect(selected[0]?.override?.categoryType).toBe("CONVERSATION");
    expect(selected[0]?.override?.execution).toBeNull();
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
