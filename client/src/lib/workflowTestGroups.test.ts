import { describe, expect, test } from "bun:test";
import {
  resolveRunningProgressCounts,
  shouldSoftAbortOnWake,
  STREAM_STALE_MS,
  failuresGroupFromReport,
  failureResultsToFormGroups,
  isEphemeralFailuresGroup,
} from "./workflowTestGroups";

describe("resolveRunningProgressCounts", () => {
  test("uses plannedQueries over summary.total while running", () => {
    expect(
      resolveRunningProgressCounts({
        plannedQueries: 1000,
        resultsLength: 576,
        runStatus: "running",
      }),
    ).toEqual({ completed: 576, total: 1000 });
  });

  test("keeps previous total when plannedQueries is missing while running", () => {
    expect(
      resolveRunningProgressCounts({
        plannedQueries: 0,
        previousTotal: 1000,
        resultsLength: 576,
        runStatus: "running",
      }),
    ).toEqual({ completed: 576, total: 1000 });
  });

  test("never invents N/N from summary.total / results alone while running", () => {
    expect(
      resolveRunningProgressCounts({
        plannedQueries: 0,
        plannedItemsLength: 0,
        previousTotal: 0,
        resultsLength: 576,
        runStatus: "running",
      }),
    ).toEqual({ completed: 576, total: 0 });
  });

  test("prefers plannedItems length when plannedQueries is absent", () => {
    expect(
      resolveRunningProgressCounts({
        plannedItemsLength: 1000,
        resultsLength: 576,
        runStatus: "running",
      }),
    ).toEqual({ completed: 576, total: 1000 });
  });

  test("terminal runs may use results length as total", () => {
    expect(
      resolveRunningProgressCounts({
        plannedQueries: 0,
        resultsLength: 576,
        runStatus: "completed",
      }),
    ).toEqual({ completed: 576, total: 576 });
  });
});

describe("shouldSoftAbortOnWake", () => {
  test("does not soft-abort a healthy recent stream", () => {
    expect(
      shouldSoftAbortOnWake({
        hasActiveRunController: true,
        hasSoftStreamController: true,
        lastProgressAtMs: 1_000_000,
        nowMs: 1_000_000 + STREAM_STALE_MS - 1,
      }),
    ).toBe(false);
  });

  test("soft-aborts only when stream is stale beyond threshold", () => {
    expect(
      shouldSoftAbortOnWake({
        hasActiveRunController: true,
        hasSoftStreamController: true,
        lastProgressAtMs: 1_000_000,
        nowMs: 1_000_000 + STREAM_STALE_MS,
      }),
    ).toBe(true);
  });

  test("does not soft-abort without an active stream", () => {
    expect(
      shouldSoftAbortOnWake({
        hasActiveRunController: false,
        hasSoftStreamController: true,
        lastProgressAtMs: 0,
        nowMs: STREAM_STALE_MS + 1,
      }),
    ).toBe(false);
  });

  test("does not soft-abort when progress timestamp is unknown", () => {
    expect(
      shouldSoftAbortOnWake({
        hasActiveRunController: true,
        hasSoftStreamController: true,
        lastProgressAtMs: null,
        nowMs: STREAM_STALE_MS + 1,
      }),
    ).toBe(false);
  });
});

describe("failuresGroupFromReport", () => {
  test("builds an ephemeral failures group from fail/error rows only", () => {
    const group = failuresGroupFromReport({
      runId: "run-1",
      results: [
        { groupName: "A", query: "q1", status: "pass" },
        { groupName: "A", query: "q2", status: "fail" },
        { groupName: "B", query: "q3", status: "error" },
      ],
    });

    expect(group).not.toBeNull();
    expect(isEphemeralFailuresGroup(group)).toBe(true);
    expect(group!.queries).toEqual(["q2", "q3"]);
    expect(group!.failureQueries).toEqual([
      { query: "q2", sourceGroupName: "A", sourceRunId: "run-1" },
      { query: "q3", sourceGroupName: "B", sourceRunId: "run-1" },
    ]);
  });

  test("returns null when there are no failures", () => {
    expect(
      failuresGroupFromReport({
        runId: "run-1",
        results: [{ groupName: "A", query: "q1", status: "pass" }],
      }),
    ).toBeNull();
  });
});

describe("failureResultsToFormGroups", () => {
  test("preserves group names and category types for fail/error rows", () => {
    expect(
      failureResultsToFormGroups([
        {
          groupName: "Orders",
          query: "list orders",
          status: "fail",
          categoryType: "CONVERSATION",
        },
        {
          groupName: "Orders",
          query: "count orders",
          status: "error",
          categoryType: "CONVERSATION",
        },
        {
          groupName: "Users",
          query: "list users",
          status: "fail",
          categoryType: "STANDARD",
        },
        {
          groupName: "Users",
          query: "ok",
          status: "pass",
          categoryType: "STANDARD",
        },
      ]),
    ).toEqual([
      {
        name: "Orders",
        queriesText: "list orders\ncount orders",
        categoryType: "CONVERSATION",
      },
      {
        name: "Users",
        queriesText: "list users",
        categoryType: "STANDARD",
      },
    ]);
  });

  test("returns empty when there are no failures", () => {
    expect(
      failureResultsToFormGroups([
        { groupName: "A", query: "q1", status: "pass" },
      ]),
    ).toEqual([]);
  });
});

describe("setup refresh test id resolution", () => {
  test("prefers loadedTestId then falls back to report.testId", () => {
    const resolveSetupRefreshTestId = (
      loadedTestId: string | null,
      reportTestId: string | null | undefined,
    ) => loadedTestId ?? reportTestId ?? null;

    expect(resolveSetupRefreshTestId(null, "test-from-report")).toBe(
      "test-from-report",
    );
    expect(resolveSetupRefreshTestId("loaded", "test-from-report")).toBe(
      "loaded",
    );
    expect(resolveSetupRefreshTestId(null, null)).toBeNull();
  });
});
