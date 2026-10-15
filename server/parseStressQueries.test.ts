import { describe, expect, test } from "bun:test";
import {
  assertPlannedMatchesConfigured,
  parseQueries,
} from "./parseStressQueries.js";
import { parseWorkflowTestJson } from "../client/src/lib/parseWorkflowTestJson.ts";

describe("parseQueries", () => {
  test("keeps commas, parentheses, and quotes inside one query", () => {
    const text = [
      `Show claims where status in ('APPROVED', 'PENDING') and hospital is "City, General"`,
      `Count rows (paid, unpaid) for district "North, East"`,
    ].join("\n");

    expect(parseQueries(text)).toEqual([
      `Show claims where status in ('APPROVED', 'PENDING') and hospital is "City, General"`,
      `Count rows (paid, unpaid) for district "North, East"`,
    ]);
  });

  test("does not split a single-line question on commas", () => {
    expect(parseQueries("List hospitals in Delhi, Mumbai, and Chennai")).toEqual([
      "List hospitals in Delhi, Mumbai, and Chennai",
    ]);
  });
});

describe("assertPlannedMatchesConfigured", () => {
  test("throws when the counts differ", () => {
    expect(() => assertPlannedMatchesConfigured(100, 107)).toThrow(
      "Planned query count 107 does not match configured count 100.",
    );
  });
});

describe("parseWorkflowTestJson query count", () => {
  test("rejects a suite whose queryCount does not match the parsed queries", () => {
    const result = parseWorkflowTestJson({
      testName: "Claims",
      queryCount: 1,
      groups: [
        {
          name: "Standard",
          queries: [
            "How many claims in Delhi, Mumbai?",
            "List approved claims",
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("does not match configured count");
    }
  });

  test("keeps object entries and comma-containing strings as one query each", () => {
    const result = parseWorkflowTestJson({
      testName: "Claims",
      queryCount: 2,
      groups: [
        {
          name: "Standard",
          queries: [
            "How many claims in Delhi, Mumbai?",
            { query: `Show status in ('A', 'B')` },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.groups[0]?.queriesText.split("\n")).toHaveLength(2);
    }
  });
});
