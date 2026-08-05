import { describe, expect, test } from "bun:test";
import { resolveWatchPlannedTotal } from "./workflowTestRunPersistence.js";

describe("resolveWatchPlannedTotal", () => {
  test("uses plannedQueries while running even when summary.total matches results", () => {
    expect(
      resolveWatchPlannedTotal({
        plannedQueries: 1000,
        plannedItemsLength: 0,
        resultsLength: 576,
        summaryTotal: 576,
        runStatus: "running",
      }),
    ).toBe(1000);
  });

  test("uses plannedItems length when plannedQueries is missing", () => {
    expect(
      resolveWatchPlannedTotal({
        plannedQueries: 0,
        plannedItemsLength: 1000,
        resultsLength: 576,
        summaryTotal: 576,
        runStatus: "running",
      }),
    ).toBe(1000);
  });

  test("does not fall back to summary.total or results.length while running", () => {
    expect(
      resolveWatchPlannedTotal({
        plannedQueries: 0,
        plannedItemsLength: 0,
        resultsLength: 576,
        summaryTotal: 576,
        runStatus: "running",
      }),
    ).toBe(0);
  });

  test("terminal runs may fall back to summary.total / results.length", () => {
    expect(
      resolveWatchPlannedTotal({
        plannedQueries: 0,
        plannedItemsLength: 0,
        resultsLength: 576,
        summaryTotal: 576,
        runStatus: "completed",
      }),
    ).toBe(576);
  });
});
