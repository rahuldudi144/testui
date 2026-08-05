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

  test("rejects invalid expectedOutcome values via normalize (drops them)", () => {
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
    // Invalid outcome ignored → no execution overrides stored
    expect(result.data.groups[0]?.execution).toBeUndefined();
  });
});
