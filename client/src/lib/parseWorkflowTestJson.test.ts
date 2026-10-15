import { describe, expect, test } from "bun:test";
import {
  parseWorkflowTestJson,
  WORKFLOW_TEST_JSON_EXAMPLE,
} from "./parseWorkflowTestJson";

describe("parseWorkflowTestJson", () => {
  test("parses example JSON", () => {
    const result = parseWorkflowTestJson(WORKFLOW_TEST_JSON_EXAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.testName).toBe("Q1 regression — sales queries");
    expect(result.data.groups.some((g) => g.name === "Scaffold (empty)")).toBe(
      true,
    );
    const empty = result.data.groups.find((g) => g.name === "Scaffold (empty)");
    expect(empty?.queriesText).toBe("");
  });

  test("allows empty queries arrays", () => {
    const result = parseWorkflowTestJson({
      testName: "Scaffold",
      description: "ignored metadata",
      groups: [{ name: "Basic", categoryType: "STANDARD", queries: [] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.groups).toHaveLength(1);
    expect(result.data.groups[0]?.queriesText).toBe("");
  });

  test("accepts query objects and expectedOutcome", () => {
    const result = parseWorkflowTestJson({
      testName: "Objects",
      groups: [
        {
          name: "Conv",
          categoryType: "STRESS",
          execution: { history: "KEEP", expectedOutcome: "SUCCESS", timeoutMs: 1000 },
          queries: [{ query: "Show farmers from Jaipur." }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.groups[0]?.queriesText).toBe("Show farmers from Jaipur.");
    expect(result.data.groups[0]?.execution).toEqual({
      history: "KEEP",
      expectedOutcome: "SUCCESS",
      timeoutMs: 1000,
    });
  });

  test("accepts legacy expectedResult / history", () => {
    const result = parseWorkflowTestJson({
      testName: "Legacy",
      groups: [
        {
          name: "G",
          queries: ["q"],
          execution: {
            history: "keep",
            expectedResult: "planner_skip",
            executeSql: false,
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.groups[0]?.execution).toEqual({
      history: "KEEP",
      expectedOutcome: "PLANNER_SKIP",
    });
  });

  test("rejects empty array entries and duplicate query keys", () => {
    const empty = parseWorkflowTestJson({
      testName: "Claims",
      groups: [{ name: "Standard", queries: ["ok", ""] }],
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe("groups[0] queries[1] is empty");

    const duplicate = parseWorkflowTestJson({
      testName: "Claims",
      groups: [
        { name: "Standard", queries: ["How many claims in Delhi, Mumbai?"] },
        { name: "Standard", queries: [{ query: "How many claims in Delhi, Mumbai?" }] },
      ],
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error).toContain("Duplicate queryKey Standard::");
    }
  });

  test("maps the legacy HALLUCINATION outcome to SCHEMA_NOT_FOUND", () => {
    const result = parseWorkflowTestJson({
      testName: "Bad expected",
      groups: [
        {
          name: "H",
          categoryType: "HALLUCINATION",
          execution: { expectedOutcome: "HALLUCINATION" },
          queries: ["x"],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.groups[0]?.execution).toEqual({
      expectedOutcome: "SCHEMA_NOT_FOUND",
    });
  });
});
