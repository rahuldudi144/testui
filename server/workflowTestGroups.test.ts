import { describe, expect, test } from "bun:test";
import { flattenGroupRecords } from "./parseStressQueries.js";
import {
  collectFailuresForImport,
  normalizeQueryKey,
} from "./workflowTestGroups.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

function makeResult(
  partial: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "status">,
): QueryRunResult {
  return {
    groupName: "Group A",
    failurePhase: "none",
    durationMs: 1,
    ...partial,
  };
}

describe("normalizeQueryKey", () => {
  test("trims and collapses whitespace", () => {
    expect(normalizeQueryKey("  show   orders  ")).toBe("show orders");
  });
});

describe("flattenGroupRecords", () => {
  const groups = [
    {
      id: "g1",
      name: "Manual",
      kind: "manual" as const,
      sortOrder: 0,
      queries: ["q1", "q2"],
    },
    {
      id: "g2",
      name: "Failed queries",
      kind: "failures" as const,
      sortOrder: 1,
      queries: ["q3"],
    },
  ];

  test("flattens all groups when groupIds omitted", () => {
    expect(flattenGroupRecords(groups)).toEqual([
      { groupId: "g1", groupName: "Manual", query: "q1" },
      { groupId: "g1", groupName: "Manual", query: "q2" },
      { groupId: "g2", groupName: "Failed queries", query: "q3" },
    ]);
  });

  test("filters by groupIds", () => {
    expect(flattenGroupRecords(groups, ["g2"])).toEqual([
      { groupId: "g2", groupName: "Failed queries", query: "q3" },
    ]);
  });
});

describe("collectFailuresForImport", () => {
  test("includes only fail and error statuses", () => {
    const results = [
      makeResult({ query: "pass", status: "pass" }),
      makeResult({ query: "fail one", status: "fail", groupName: "G1" }),
      makeResult({ query: "err", status: "error", groupName: "G2" }),
      makeResult({ query: "skip", status: "planner_skip" }),
    ];

    expect(collectFailuresForImport(results, [])).toEqual([
      { query: "fail one", groupName: "G1" },
      { query: "err", groupName: "G2" },
    ]);
  });

  test("dedupes against existing queries and within the batch", () => {
    const results = [
      makeResult({ query: "same query", status: "fail" }),
      makeResult({ query: "  same   query ", status: "error" }),
      makeResult({ query: "new query", status: "fail" }),
    ];

    expect(collectFailuresForImport(results, ["same query"])).toEqual([
      { query: "new query", groupName: "Group A" },
    ]);
  });
});
