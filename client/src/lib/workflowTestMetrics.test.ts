import { describe, expect, test } from "bun:test";
import type { QueryRunResult, WorkflowTestCompletePayload } from "../api";
import { buildLightweightRunMetrics, buildRunMetrics } from "./workflowTestMetrics";

function result(
  overrides: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "groupName">,
): QueryRunResult {
  return {
    status: "pass",
    failurePhase: "none",
    durationMs: 100,
    ...overrides,
  };
}

function report(results: QueryRunResult[]): WorkflowTestCompletePayload {
  return {
    testName: "metrics fixture",
    dryRun: true,
    database: { dbType: "postgres", name: "db", host: "localhost" },
    ranAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      errors: results.filter((r) => r.status === "error").length,
      plannerSkipped: results.filter((r) => r.status === "planner_skip").length,
      byPhase: {},
      byGroup: {},
      byCategory: {
        STANDARD: { total: 1, passed: 1, failed: 0, errors: 0, plannerSkipped: 0 },
        PLANNER_SKIP: {
          total: 1,
          passed: 0,
          failed: 1,
          errors: 0,
          plannerSkipped: 0,
        },
      },
      outcomeMatched: 1,
      outcomeMismatched: 1,
    },
    results,
  };
}

describe("buildRunMetrics", () => {
  test("aggregates byCategory and outcome alignment", () => {
    const metrics = buildRunMetrics(
      report([
        result({
          groupName: "a",
          query: "list users",
          categoryType: "STANDARD",
          expectedOutcome: "SUCCESS",
          actualOutcome: "success",
          status: "pass",
        }),
        result({
          groupName: "b",
          query: "delete all",
          categoryType: "PLANNER_SKIP",
          expectedOutcome: "PLANNER_SKIP",
          actualOutcome: "success",
          status: "fail",
        }),
      ]),
    );

    expect(metrics.byCategory).toHaveLength(2);
    expect(metrics.outcomeAlignment).toEqual({
      matched: 1,
      mismatched: 1,
      errors: 0,
    });
    expect(metrics.byActualOutcome.map((e) => e.outcome).sort()).toEqual([
      "success",
    ]);
    expect(metrics.perQuery[0]?.outcomeMatched).toBe(true);
    expect(metrics.perQuery[1]?.outcomeMatched).toBe(false);
    expect(metrics.perQuery[0]?.categoryType).toBe("STANDARD");
  });

  test("lightweight mode skips per-query and LLM aggregates", () => {
    const metrics = buildLightweightRunMetrics(
      report([
        result({ groupName: "a", query: "q1", status: "pass" }),
        result({ groupName: "b", query: "q2", status: "fail" }),
      ]),
    );
    expect(metrics.perQuery).toEqual([]);
    expect(metrics.llmByNode).toEqual([]);
    expect(metrics.attemptDistribution).toEqual([]);
    expect(metrics.statusBreakdown.passed).toBe(1);
    expect(metrics.statusBreakdown.failed).toBe(1);
  });

  test("perQueryLimit keeps the slowest queries", () => {
    const metrics = buildRunMetrics(
      report([
        result({ groupName: "a", query: "fast", durationMs: 10 }),
        result({ groupName: "a", query: "slow", durationMs: 900 }),
        result({ groupName: "a", query: "mid", durationMs: 100 }),
      ]),
      { perQueryLimit: 2 },
    );
    expect(metrics.perQuery).toHaveLength(2);
    expect(metrics.perQuery[0]?.query).toBe("slow");
    expect(metrics.perQuery[1]?.query).toBe("mid");
  });

  test("derives byCategory from results when summary omits it", () => {
    const payload = report([
      result({
        groupName: "g",
        query: "q1",
        categoryType: "CONVERSATION",
        status: "pass",
      }),
      result({
        groupName: "g",
        query: "q2",
        categoryType: "CONVERSATION",
        status: "error",
      }),
    ]);
    payload.summary.byCategory = undefined;
    payload.summary.outcomeMatched = undefined;
    payload.summary.outcomeMismatched = undefined;

    const metrics = buildRunMetrics(payload);
    expect(metrics.byCategory).toEqual([
      {
        categoryType: "CONVERSATION",
        passed: 1,
        failed: 0,
        errors: 1,
        plannerSkipped: 0,
        total: 2,
      },
    ]);
  });
});
