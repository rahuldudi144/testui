import { describe, expect, test } from "bun:test";
import { flattenGroupRecords } from "./parseStressQueries.js";
import {
  collectFailuresForImport,
  groupFailuresBySourceForExport,
  isDefaultFailuresGroupName,
  mergeManualGroupsPreservingImported,
  normalizeQueryKey,
  resolveFailureExportTestName,
} from "./workflowTestGroups.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

function makeResult(
  partial: Partial<QueryRunResult> & Pick<QueryRunResult, "query" | "status">,
): QueryRunResult {
  return {
    groupName: "Group A",
    failurePhase: "none",
    durationMs: 1,
    ...partial,
  };
}

describe("normalizeQueryKey", () => {
  test("trims and collapses whitespace", () => {
    expect(normalizeQueryKey("  show   orders  ")).toBe("show orders");
  });
});

describe("isDefaultFailuresGroupName", () => {
  test("treats empty and Failed queries as the failures bucket", () => {
    expect(isDefaultFailuresGroupName(undefined)).toBe(true);
    expect(isDefaultFailuresGroupName(null)).toBe(true);
    expect(isDefaultFailuresGroupName("")).toBe(true);
    expect(isDefaultFailuresGroupName("  ")).toBe(true);
    expect(isDefaultFailuresGroupName("Failed queries")).toBe(true);
    expect(isDefaultFailuresGroupName("failed queries")).toBe(true);
  });

  test("treats any other name as a named manual group", () => {
    expect(isDefaultFailuresGroupName("Retry batch")).toBe(false);
    expect(isDefaultFailuresGroupName("Failed queries v2")).toBe(false);
  });
});

describe("flattenGroupRecords", () => {
  const groups = [
    {
      id: "g1",
      name: "Manual",
      kind: "manual" as const,
      sortOrder: 0,
      queries: ["q1", "q2"],
      categoryType: "STANDARD" as const,
      executionOverrides: null,
    },
    {
      id: "g2",
      name: "Failed queries",
      kind: "failures" as const,
      sortOrder: 1,
      queries: ["q3"],
      categoryType: "STANDARD" as const,
      executionOverrides: null,
    },
  ];

  test("flattens all groups when groupIds omitted", () => {
    expect(flattenGroupRecords(groups)).toEqual([
      {
        groupId: "g1",
        groupName: "Manual",
        query: "q1",
        categoryType: "STANDARD",
        executionOverrides: null,
      },
      {
        groupId: "g1",
        groupName: "Manual",
        query: "q2",
        categoryType: "STANDARD",
        executionOverrides: null,
      },
      {
        groupId: "g2",
        groupName: "Failed queries",
        query: "q3",
        categoryType: "STANDARD",
        executionOverrides: null,
      },
    ]);
  });

  test("filters by groupIds", () => {
    expect(flattenGroupRecords(groups, ["g2"])).toEqual([
      {
        groupId: "g2",
        groupName: "Failed queries",
        query: "q3",
        categoryType: "STANDARD",
        executionOverrides: null,
      },
    ]);
  });
});

describe("collectFailuresForImport", () => {
  test("includes only fail and error statuses", () => {
    const results = [
      makeResult({ query: "pass", status: "pass" }),
      makeResult({ query: "fail one", status: "fail", groupName: "G1" }),
      makeResult({ query: "err", status: "error", groupName: "G2" }),
      makeResult({ query: "skip", status: "planner_skip" }),
    ];

    expect(collectFailuresForImport(results, [])).toEqual([
      { query: "fail one", groupName: "G1" },
      { query: "err", groupName: "G2" },
    ]);
  });

  test("dedupes against existing queries and within the batch", () => {
    const results = [
      makeResult({ query: "same query", status: "fail" }),
      makeResult({ query: "  same   query ", status: "error" }),
      makeResult({ query: "new query", status: "fail" }),
    ];

    expect(collectFailuresForImport(results, ["same query"])).toEqual([
      { query: "new query", groupName: "Group A" },
    ]);
  });
});

describe("groupFailuresBySourceForExport", () => {
  test("keeps original groups and category types", () => {
    const grouped = groupFailuresBySourceForExport(
      [
        {
          query: "q1",
          groupName: "Conversation Memory",
          categoryType: "CONVERSATION",
        },
        {
          query: "q2",
          groupName: "Hallucination",
          categoryType: "HALLUCINATION",
        },
        {
          query: "q3",
          groupName: "Conversation Memory",
          categoryType: "CONVERSATION",
        },
      ],
      [
        {
          name: "Conversation Memory",
          categoryType: "CONVERSATION",
          executionOverrides: { history: "KEEP" },
        },
      ],
    );

    expect(grouped).toEqual([
      {
        groupName: "Conversation Memory",
        categoryType: "CONVERSATION",
        executionOverrides: { history: "KEEP" },
        queries: ["q1", "q3"],
      },
      {
        groupName: "Hallucination",
        categoryType: "HALLUCINATION",
        executionOverrides: null,
        queries: ["q2"],
      },
    ]);
  });

  test("falls back to parent group category when result omits it", () => {
    const grouped = groupFailuresBySourceForExport(
      [{ query: "q1", groupName: "Planner Skip" }],
      [{ name: "Planner Skip", categoryType: "PLANNER_SKIP" }],
    );
    expect(grouped[0]?.categoryType).toBe("PLANNER_SKIP");
  });
});

describe("resolveFailureExportTestName", () => {
  test("uses the provided name when present", () => {
    expect(
      resolveFailureExportTestName("Parent", "Failed queries mati-gpt-4o"),
    ).toBe("Failed queries mati-gpt-4o");
  });

  test("falls back to parent — Failed queries", () => {
    expect(resolveFailureExportTestName("Agriculture Suite", "")).toBe(
      "Agriculture Suite — Failed queries",
    );
    expect(resolveFailureExportTestName("Agriculture Suite", null)).toBe(
      "Agriculture Suite — Failed queries",
    );
  });
});

describe("mergeManualGroupsPreservingImported", () => {
  test("preserves imported groups missing from the form payload", () => {
    const { incoming, preserved } = mergeManualGroupsPreservingImported(
      [{ name: "Basic Select", queries: ["q1"] }],
      [
        {
          name: "Basic Select",
          hasImportedQueries: false,
        },
        {
          name: "Failed queries mati-gpt-4o",
          hasImportedQueries: true,
        },
        {
          name: "Scratch",
          hasImportedQueries: false,
        },
      ],
    );

    expect(incoming).toEqual([{ name: "Basic Select", queries: ["q1"] }]);
    expect(preserved.map((group) => group.name)).toEqual([
      "Failed queries mati-gpt-4o",
    ]);
  });

  test("does not duplicate imported groups already present in the form", () => {
    const { preserved } = mergeManualGroupsPreservingImported(
      [
        { name: "Basic Select", queries: ["q1"] },
        { name: "Failed queries mati-gpt-4o", queries: ["fail"] },
      ],
      [
        {
          name: "Failed queries mati-gpt-4o",
          hasImportedQueries: true,
        },
      ],
    );

    expect(preserved).toEqual([]);
  });
});
