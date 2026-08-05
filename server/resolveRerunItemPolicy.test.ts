import { describe, expect, test } from "bun:test";
import { resolveRerunItemPolicy } from "./workflowTestCategory.js";

describe("resolveRerunItemPolicy", () => {
  test("keeps original result policy when no override is provided", () => {
    expect(
      resolveRerunItemPolicy({
        categoryType: "STANDARD",
        expectedOutcome: "SUCCESS",
        history: "RESET",
        stopOnFailure: false,
        timeoutMs: 12000,
      }),
    ).toEqual({
      categoryType: "STANDARD",
      expectedOutcome: "SUCCESS",
      history: "RESET",
      stopOnFailure: false,
      timeoutMs: 12000,
    });
  });

  test("applies Setup execution overrides over stored result policy", () => {
    const policy = resolveRerunItemPolicy(
      {
        categoryType: "STANDARD",
        expectedOutcome: "SUCCESS",
        history: "RESET",
        stopOnFailure: false,
        timeoutMs: 5000,
      },
      {
        categoryType: "CONVERSATION",
        execution: {
          history: "KEEP",
          expectedOutcome: "CLARIFICATION",
          stopOnFailure: true,
          timeoutMs: 30000,
        },
      },
    );

    expect(policy.categoryType).toBe("CONVERSATION");
    expect(policy.history).toBe("KEEP");
    expect(policy.expectedOutcome).toBe("CLARIFICATION");
    expect(policy.stopOnFailure).toBe(true);
    expect(policy.timeoutMs).toBe(30000);
  });

  test("null execution override falls back to category defaults", () => {
    const policy = resolveRerunItemPolicy(
      {
        categoryType: "STANDARD",
        expectedOutcome: "SUCCESS",
        history: "KEEP",
        timeoutMs: 999,
      },
      {
        categoryType: "STANDARD",
        execution: null,
      },
    );

    expect(policy.history).toBe("RESET");
    expect(policy.expectedOutcome).toBe("SUCCESS");
  });
});
