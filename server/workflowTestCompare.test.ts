import { describe, expect, test } from "bun:test";
import {
  alignCompareResults,
  countOverlappingQueries,
  resultQueryKey,
} from "./workflowTestCompare.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

function makeResult(
  partial: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "status">,
): QueryRunResult {
  return {
    groupName: partial.groupName ?? "Group A",
    failurePhase: "none",
    durationMs: 100,
    ...partial,
  };
}

describe("resultQueryKey", () => {
  test("uses queryKey when present", () => {
    const result = makeResult({
      query: "count users",
      status: "pass",
      queryKey: "custom-key",
    });
    expect(resultQueryKey(result)).toBe("custom-key");
  });
});

describe("alignCompareResults", () => {
  test("aligns rows by queryKey and flags status mismatches", () => {
    const resultsA = [
      makeResult({ query: "show orders", status: "pass", queryKey: "g1::show orders" }),
      makeResult({ query: "count users", status: "fail", queryKey: "g1::count users" }),
    ];
    const resultsB = [
      makeResult({ query: "show orders", status: "pass", queryKey: "g1::show orders" }),
      makeResult({ query: "count users", status: "pass", queryKey: "g1::count users" }),
    ];

    const rows = alignCompareResults(resultsA, resultsB);
    expect(rows).toHaveLength(2);

    const orders = rows.find((row) => row.queryKey === "g1::show orders");
    const users = rows.find((row) => row.queryKey === "g1::count users");

    expect(orders?.statusMatch).toBe(true);
    expect(users?.statusMatch).toBe(false);
  });

  test("includes queries only present on one side", () => {
    const resultsA = [
      makeResult({ query: "only A", status: "pass", queryKey: "only-a" }),
    ];
    const resultsB = [
      makeResult({ query: "only B", status: "fail", queryKey: "only-b" }),
    ];

    const rows = alignCompareResults(resultsA, resultsB);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.statusMatch === false)).toBe(true);
  });
});

describe("countOverlappingQueries", () => {
  test("counts shared query keys", () => {
    const resultsA = [
      makeResult({ query: "a", status: "pass", queryKey: "shared" }),
      makeResult({ query: "b", status: "pass", queryKey: "only-a" }),
    ];
    const resultsB = [
      makeResult({ query: "a", status: "fail", queryKey: "shared" }),
      makeResult({ query: "c", status: "fail", queryKey: "only-b" }),
    ];

    expect(countOverlappingQueries(resultsA, resultsB)).toBe(1);
  });
});
