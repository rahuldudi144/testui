import { describe, expect, test } from "bun:test";
import type { QueryRunResult } from "../stressTestAnalyze.js";
import type { GoldenItem } from "./scorer.js";
import {
  buildGoldenSummary,
  scoreWorkflowResult,
  singleReadStatement,
  snapshotsDiffer,
} from "./scoreRun.js";

const item: GoldenItem = {
  id: "Q1",
  queryKey: "Standard::How many?",
  group: "Standard",
  categoryType: "STANDARD",
  query: "How many?",
  check: "scalar",
  accepted: [{ value: 2, columns: ["n", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"] }],
};

function baseResult(patch: Partial<QueryRunResult> = {}): QueryRunResult {
  return {
    groupName: "Standard",
    query: "How many?",
    status: "pass",
    failurePhase: "none",
    durationMs: 1,
    generatedSql: "select 2",
    actualOutcome: "success",
    markdownResponse: "2",
    ...patch,
  };
}

describe("scoreWorkflowResult", () => {
  test("marks a suite query with no golden item as not scored", async () => {
    const scored = await scoreWorkflowResult({
      result: baseResult(),
      capture: null,
      item: undefined,
      runIndex: 2,
      goldenAttempts: 1,
    });
    expect(scored.goldenStatus).toBe("NOT_SCORED");
    expect(scored.runIndex).toBe(2);
  });

  test("truncates previews to 20 rows and 12 columns", async () => {
    const wide = Array.from({ length: 14 }, (_, index) => `c${index}`);
    const rows = Array.from({ length: 25 }, () =>
      Object.fromEntries(wide.map((column) => [column, 1])),
    );
    const scored = await scoreWorkflowResult({
      result: baseResult(),
      capture: {
        errorCode: null,
        executionResult: { columns: wide, rows, rowCount: rows.length },
      },
      item,
      runIndex: 1,
      goldenAttempts: 3,
    });
    const preview = scored.gotPreview as { columns: string[]; rows: unknown[][] };
    expect(preview.columns).toHaveLength(12);
    expect(preview.rows).toHaveLength(20);
    expect(preview.rows[0]).toHaveLength(12);
    expect(scored.goldenAttempts).toBe(3);
  });
});

describe("golden summary", () => {
  test("accuracy ignores infrastructure errors", () => {
    const summary = buildGoldenSummary(
      [
        baseResult({ goldenId: "Q1", goldenStatus: "PASS" }),
        baseResult({ goldenId: "Q2", query: "b", goldenStatus: "FAIL", goldenReason: "mismatch" }),
        baseResult({ goldenId: "Q3", query: "c", goldenStatus: "INFRA_ERROR", goldenReason: "timeout" }),
        baseResult({ goldenId: "Q4", query: "d", goldenStatus: "NOT_SCORED" }),
      ],
      null,
    );
    expect(summary.accuracy).toBe(0.5);
    expect(summary.counts.INFRA_ERROR).toBe(1);
    expect(summary.counts.NOT_SCORED).toBe(1);
    expect(summary.rawPassRate).toBeCloseTo(1 / 3);
  });

  test("pass^k requires every repeat to pass", () => {
    const summary = buildGoldenSummary(
      [
        baseResult({ goldenId: "Q1", runIndex: 1, goldenStatus: "PASS" }),
        baseResult({ goldenId: "Q1", runIndex: 2, goldenStatus: "FAIL", goldenReason: "mismatch" }),
      ],
      null,
    );
    expect(summary.passCaretK).toBe(0);
    expect(summary.passAtK).toBe(1);
  });
});

describe("read-only helpers", () => {
  test("rejects a second SQL statement", () => {
    expect(singleReadStatement("select 1; select 2")).toBeNull();
    expect(singleReadStatement("select 1;")).toBe("select 1");
  });

  test("detects a changed table count", () => {
    const before = { tables: ["hospitals"], counts: { hospitals: 1 }, tuples: { hospitals: 1 } };
    const after = { tables: ["hospitals"], counts: { hospitals: 2 }, tuples: { hospitals: 1 } };
    expect(snapshotsDiffer(before, after)).toBe(true);
    expect(snapshotsDiffer(before, before)).toBe(false);
  });
});
