import { describe, expect, test } from "bun:test";
import { parseWorkflowTestJson } from "../client/src/lib/parseWorkflowTestJson.ts";

describe("parseWorkflowTestJson", () => {
  test("imports empty-query suite skeleton", () => {
    const result = parseWorkflowTestJson({
      testName: "Agriculture Regression Suite",
      description: "Regression suite for Agriculture SQL Agent",
      groups: [
        {
          name: "Basic Select",
          categoryType: "STANDARD",
          execution: {
            history: "RESET",
            expectedOutcome: "SUCCESS",
            timeoutMs: 30000,
            stopOnFailure: false,
          },
          queries: [],
        },
        {
          name: "Conversation Memory",
          categoryType: "CONVERSATION",
          execution: {
            history: "KEEP",
            expectedOutcome: "SUCCESS",
            timeoutMs: 30000,
          },
          queries: [],
        },
        {
          name: "Hallucination",
          categoryType: "HALLUCINATION",
          execution: {
            history: "RESET",
            expectedOutcome: "HALLUCINATION",
            timeoutMs: 30000,
          },
          queries: [],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.testName).toBe("Agriculture Regression Suite");
    expect(result.data.groups).toHaveLength(3);
    expect(result.data.groups[0]?.queriesText).toBe("");
    expect(result.data.groups[0]?.categoryType).toBe("STANDARD");
    expect(result.data.groups[0]?.execution).toEqual({
      history: "RESET",
      expectedOutcome: "SUCCESS",
      timeoutMs: 30000,
      stopOnFailure: false,
    });
    expect(result.data.groups[1]?.execution?.history).toBe("KEEP");
    expect(result.data.groups[2]?.execution?.expectedOutcome).toBe(
      "SCHEMA_NOT_FOUND",
    );
  });

  test("parses query objects and strings", () => {
    const result = parseWorkflowTestJson({
      testName: "Mixed queries",
      groups: [
        {
          name: "G1",
          queries: [{ query: "Show farms" }, "List crops"],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.groups[0]?.queriesText).toBe("Show farms\nList crops");
  });

  test("rejects invalid queries field", () => {
    const result = parseWorkflowTestJson({
      testName: "Bad",
      groups: [{ name: "G1", queries: [123] }],
    });
    expect(result.ok).toBe(false);
  });
});
