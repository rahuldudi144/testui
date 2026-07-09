import { describe, expect, test } from "bun:test";
import type { QueryRunResult } from "./stressTestAnalyze.js";
import {
  buildWorkflowRunSummary,
  collectRemainingItems,
  isResumableRunSummary,
  parsePlannedItems,
} from "./workflowTestRunPersistence.js";

function result(
  groupName: string,
  query: string,
  status: QueryRunResult["status"] = "pass",
): QueryRunResult {
  return {
    groupName,
    query,
    status,
    durationMs: 1,
    failurePhase: "none",
  };
}

describe("workflowTestRunPersistence", () => {
  test("collectRemainingItems skips completed query keys", () => {
    const planned = [
      { groupName: "A", query: "q1" },
      { groupName: "A", query: "q2" },
      { groupName: "B", query: "q3" },
    ];
    const completed = [result("A", "q1"), result("A", "q2")];
    expect(collectRemainingItems(planned, completed)).toEqual([
      { groupName: "B", query: "q3" },
    ]);
  });

  test("parsePlannedItems reads plannedItems from summary", () => {
    const summary = buildWorkflowRunSummary(
      [],
      2,
      "running",
      [
        { groupName: "G", query: "one" },
        { groupName: "G", query: "two" },
      ],
    );
    expect(parsePlannedItems(summary)).toEqual([
      { groupName: "G", query: "one" },
      { groupName: "G", query: "two" },
    ]);
  });

  test("isResumableRunSummary detects partial runs", () => {
    const summary = buildWorkflowRunSummary([], 5, "cancelled", []);
    expect(isResumableRunSummary(summary, 2)).toBe(true);
    expect(isResumableRunSummary(summary, 5)).toBe(false);
    expect(isResumableRunSummary({ ...summary, runStatus: "completed" }, 2)).toBe(
      false,
    );
  });
});
