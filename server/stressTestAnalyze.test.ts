import { describe, expect, test } from "bun:test";
import { AgentError } from "../../utils/errors.js";
import {
  analyzeStressRunResult,
  formatWorkflowAgentError,
} from "./stressTestAnalyze.js";

describe("analyzeStressRunResult formatResponse failures", () => {
  test("marks verification failure when formatResponse used a fallback", () => {
    const result = analyzeStressRunResult({
      query: "list users",
      groupName: "default",
      durationMs: 1200,
      dryRun: false,
      result: {
        markdownResponse: "## Results (formatting fallback)\n\nAutomatic formatting failed: bad format",
        generatedSql: 'SELECT * FROM "User" LIMIT 50',
        validationPassed: true,
        executionResult: {
          rowCount: 1,
          columns: ["id", "name"],
          rows: [{ id: 1, name: "Ada" }],
        },
      },
      debug: {
        workflow: {
          status: "success",
          requiresSql: true,
          validationPassed: true,
        },
        stateHistory: [
          {
            step: 1,
            node: "formatResponse",
            changes: {
              formatResponseError: "Model returned an empty formatted response.",
              markdownResponse: "## Results (formatting fallback)",
            },
          },
        ],
        graph: {
          path: ["planner", "schemaResolver", "buildQuery", "validateQuery", "runQuery", "formatResponse"],
          nodes: [],
        },
      },
    });

    expect(result.status).toBe("fail");
    expect(result.failurePhase).toBe("verification");
    expect(result.failedNode).toBe("formatResponse");
  });

  test("records agent_error with failed node from debug when invoke throws", () => {
    const result = analyzeStressRunResult({
      query: "list users",
      groupName: "default",
      durationMs: 900,
      errorMessage: formatWorkflowAgentError(
        new AgentError("MODEL_NOT_SUPPORTED", "structured output failed"),
      ),
      debug: {
        metrics: {
          nodeTimeline: [
            { node: "entityExtractor", event: "node_start" },
            { node: "entityExtractor", event: "node_error" },
          ],
        },
        graph: {
          path: ["planner", "schemaResolver", "entityExtractor"],
          nodes: [],
        },
      },
    });

    expect(result.status).toBe("error");
    expect(result.failurePhase).toBe("query_build");
    expect(result.failedNode).toBe("entityExtractor");
    expect(result.errorMessage).toContain("structured output");
  });
});
