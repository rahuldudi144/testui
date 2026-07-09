import { describe, expect, test } from "bun:test";
import type { QueryRunResult } from "../api";
import {
  alignCompareResults,
  answersMatch,
  finalAnswerText,
  normalizeAnswerForCompare,
} from "./workflowTestCompare";

function result(
  overrides: Partial<QueryRunResult> & Pick<QueryRunResult, "query">,
): QueryRunResult {
  return {
    groupName: "g",
    query: overrides.query,
    status: "pass",
    failurePhase: "none",
    ...overrides,
  };
}

describe("finalAnswerText", () => {
  test("prefers full markdownResponse over preview", () => {
    expect(
      finalAnswerText(
        result({
          query: "q",
          markdownResponse: "## Full answer",
          markdownPreview: "## Preview",
        }),
      ),
    ).toBe("## Full answer");
  });

  test("falls back to preview then error", () => {
    expect(
      finalAnswerText(
        result({ query: "q", markdownPreview: "preview only" }),
      ),
    ).toBe("preview only");
    expect(
      finalAnswerText(result({ query: "q", errorMessage: "boom" })),
    ).toBe("Error: boom");
  });
});

describe("answersMatch", () => {
  test("compares normalized whitespace", () => {
    const a = result({
      query: "q",
      markdownResponse: "Hello   world",
    });
    const b = result({
      query: "q",
      markdownResponse: "Hello world",
    });
    expect(answersMatch(a, b)).toBe(true);
    expect(
      normalizeAnswerForCompare("  a\n\nb  "),
    ).toBe("a b");
  });

  test("returns undefined when a side is missing", () => {
    expect(answersMatch(undefined, result({ query: "q" }))).toBeUndefined();
  });
});

describe("alignCompareResults", () => {
  test("includes answerMatch per aligned query", () => {
    const rows = alignCompareResults(
      [result({ query: "q1", markdownResponse: "same" })],
      [result({ query: "q1", markdownResponse: "different" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answerMatch).toBe(false);
    expect(rows[0]?.statusMatch).toBe(true);
  });
});
