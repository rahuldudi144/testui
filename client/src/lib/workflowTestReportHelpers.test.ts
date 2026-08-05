import { describe, expect, test } from "bun:test";
import {
  categoryTypeLabel,
  formatOutcomeLabel,
  isFatalAbortMessage,
  mergeQueryResultIntoReport,
  outcomesMatch,
} from "./workflowTestReportHelpers";

describe("formatOutcomeLabel", () => {
  test("formats known expected outcomes", () => {
    expect(formatOutcomeLabel("SUCCESS")).toBe("Success");
    expect(formatOutcomeLabel("PLANNER_SKIP")).toBe("Planner skip");
  });

  test("formats agent outcome strings", () => {
    expect(formatOutcomeLabel("planner_skip")).toBe("Planner skip");
    expect(formatOutcomeLabel("clarification")).toMatch(/clarification/i);
  });

  test("handles empty", () => {
    expect(formatOutcomeLabel(null)).toBe("—");
    expect(formatOutcomeLabel(undefined)).toBe("—");
  });
});

describe("outcomesMatch", () => {
  test("matches SUCCESS to success", () => {
    expect(outcomesMatch("SUCCESS", "success")).toBe(true);
  });

  test("matches PLANNER_SKIP to planner_skip", () => {
    expect(outcomesMatch("PLANNER_SKIP", "planner_skip")).toBe(true);
  });

  test("detects mismatch without case-folding expected string", () => {
    expect(outcomesMatch("SUCCESS", "planner_skip")).toBe(false);
    expect(outcomesMatch("SUCCESS", "SUCCESS")).toBe(false);
  });

  test("returns false when either side is missing", () => {
    expect(outcomesMatch("SUCCESS", undefined)).toBe(false);
    expect(outcomesMatch(undefined, "success")).toBe(false);
  });
});

describe("categoryTypeLabel", () => {
  test("labels known categories", () => {
    expect(categoryTypeLabel("CONVERSATION")).toBe("Conversation");
    expect(categoryTypeLabel(undefined)).toBe("Standard");
  });
});

describe("isFatalAbortMessage", () => {
  test("detects stop messages", () => {
    expect(
      isFatalAbortMessage("Run stopped: authentication failed (401)"),
    ).toBe(true);
    expect(isFatalAbortMessage("rate limit exceeded (429)")).toBe(true);
    expect(isFatalAbortMessage("query timed out")).toBe(false);
  });
});

describe("mergeQueryResultIntoReport", () => {
  test("updates status in place and reduces failure count", () => {
    const report = {
      results: [
        { queryKey: "a", groupName: "G", query: "q1", status: "pass" },
        { queryKey: "b", groupName: "G", query: "q2", status: "fail" },
      ],
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        errors: 0,
        plannerSkipped: 0,
      },
    };

    const merged = mergeQueryResultIntoReport(
      report,
      { queryKey: "b", groupName: "G", query: "q2", status: "pass" },
      (row) => row.queryKey ?? `${row.groupName}::${row.query}`,
    );

    expect(merged.results[1]?.status).toBe("pass");
    expect(merged.summary.passed).toBe(2);
    expect(merged.summary.failed).toBe(0);
    expect(merged.results[0]?.status).toBe("pass");
  });
});
