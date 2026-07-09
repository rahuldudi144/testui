import { describe, expect, test } from "bun:test";

describe("duplicateWorkflowTestForAgent expectations", () => {
  test("inherits suiteKey from source and builds default name", () => {
    const source = {
      id: "test-source",
      name: "Q1 regression",
      suiteKey: "suite-abc",
      dryRun: true,
      delayMs: 500,
    };
    const targetAgent = { id: "agent-b", name: "Claude agent" };

    const suiteKey = source.suiteKey ?? source.id;
    const defaultName = `${source.name} — ${targetAgent.name}`;

    expect(suiteKey).toBe("suite-abc");
    expect(defaultName).toBe("Q1 regression — Claude agent");
  });

  test("falls back suiteKey to source id when missing", () => {
    const source = {
      id: "test-source",
      name: "Legacy test",
      suiteKey: null as string | null,
    };

    const suiteKey = source.suiteKey ?? source.id;
    expect(suiteKey).toBe("test-source");
  });

  test("copies only manual groups into duplicate payload shape", () => {
    const groups = [
      {
        kind: "manual" as const,
        name: "Sales",
        queries: [{ query: "show revenue" }, { query: "top customers" }],
      },
      {
        kind: "failures" as const,
        name: "Failures",
        queries: [{ query: "bad query" }],
      },
    ];

    const manualGroups = groups
      .filter((group) => group.kind === "manual")
      .map((group) => ({
        name: group.name,
        queries: group.queries.map((query) => query.query),
      }));

    expect(manualGroups).toEqual([
      { name: "Sales", queries: ["show revenue", "top customers"] },
    ]);
  });
});
