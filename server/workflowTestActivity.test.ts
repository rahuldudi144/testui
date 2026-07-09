import { describe, expect, test } from "bun:test";
import { formatWorkflowActivityLog } from "./workflowTestActivity.js";

describe("formatWorkflowActivityLog", () => {
  test("uses human message when present", () => {
    expect(
      formatWorkflowActivityLog({
        message: "planner: evaluating domain, intent, and SQL need.",
      }),
    ).toBe("planner: evaluating domain, intent, and SQL need.");
  });

  test("formats node lifecycle events", () => {
    expect(
      formatWorkflowActivityLog({ event: "node_start", node: "buildQuery" }),
    ).toBe("buildQuery: started");
    expect(
      formatWorkflowActivityLog({
        event: "node_end",
        node: "entityExtractor",
        durationMs: 1200,
      }),
    ).toBe("entityExtractor: done (1200ms)");
  });
});
