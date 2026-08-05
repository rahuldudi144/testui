import { describe, expect, test } from "bun:test";
import type { QueryRunResult } from "./stressTestAnalyze.js";
import {
  buildWorkflowRunSummary,
  collectRemainingItems,
  isResumableRunSummary,
  orphanedRunTerminalStatus,
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
        { groupName: "A", query: "q1" },
        { groupName: "A", query: "q2" },
      ],
    );
    expect(parsePlannedItems(summary)).toEqual([
      { groupName: "A", query: "q1" },
      { groupName: "A", query: "q2" },
    ]);
  });

  test("isResumableRunSummary detects partial runs", () => {
    const summary = buildWorkflowRunSummary([], 5, "cancelled", []);
    expect(isResumableRunSummary(summary, 0)).toBe(true);
    expect(
      isResumableRunSummary({ ...summary, runStatus: "completed" }, 2),
    ).toBe(false);
  });

  test("orphanedRunTerminalStatus maps stuck running rows", () => {
    expect(orphanedRunTerminalStatus(0, 5)).toBe("cancelled");
    expect(orphanedRunTerminalStatus(2, 5)).toBe("partial");
    expect(orphanedRunTerminalStatus(5, 5)).toBe("completed");
  });
});
