import { prisma } from "./db.js";
import { loadEnv } from "./env.js";
import { saveManualGroups } from "./workflowTestGroups.js";
import type { WorkflowTestGroupRecord } from "./parseStressQueries.js";

export interface DuplicateWorkflowTestInput {
  sourceTestId: string;
  userId: string;
  testName?: string;
}

export interface DuplicateWorkflowTestResult {
  test: {
    id: string;
    name: string;
    agentProfileId: null;
    suiteKey: string;
    dryRun: boolean;
    delayMs: number;
  };
  groups: WorkflowTestGroupRecord[];
}

export async function duplicateWorkflowTestForAgent(
  input: DuplicateWorkflowTestInput,
): Promise<DuplicateWorkflowTestResult> {
  const { sourceTestId, userId } = input;

  const source = await prisma.workflowTest.findFirst({
    where: { id: sourceTestId, userId },
    include: {
      groups: {
        where: { kind: "manual" },
        orderBy: { sortOrder: "asc" },
        include: {
          queries: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!source) {
    throw new Error("Workflow test not found.");
  }

  const suiteKey = source.suiteKey ?? source.id;
  const testName = input.testName?.trim() || `${source.name} copy`;

  const existing = await prisma.workflowTest.findFirst({
    where: { userId, name: testName },
  });
  if (existing) {
    throw new Error(`A test named "${testName}" already exists.`);
  }

  const manualGroups = source.groups.map((group) => ({
    name: group.name,
    queries: group.queries.map((query) => query.query),
    categoryType: (group as { categoryType?: string }).categoryType ?? "STANDARD",
    execution:
      ((group as { executionOverrides?: unknown }).executionOverrides as
        | Record<string, unknown>
        | null) ?? undefined,
  }));

  const created = await prisma.workflowTest.create({
    data: {
      userId,
      name: testName,
      suiteKey,
      dryRun: source.dryRun,
      delayMs: source.delayMs,
    },
  });

  const groups = await saveManualGroups(created.id, manualGroups);

  return {
    test: {
      id: created.id,
      name: created.name,
      agentProfileId: null,
      suiteKey,
      dryRun: created.dryRun,
      delayMs: created.delayMs,
    },
    groups,
  };
}

export async function upsertWorkflowTest(
  userId: string,
  input: {
    testName: string;
    dryRun: boolean;
    delayMs: number;
    suiteKey?: string | null;
    goldenSetId?: string | null;
  },
): Promise<{ id: string; suiteKey: string; agentProfileId: null }> {
  const existing = await prisma.workflowTest.findFirst({
    where: {
      userId,
      name: input.testName,
    },
  });

  if (existing) {
    const updated = await prisma.workflowTest.update({
      where: { id: existing.id },
      data: {
        dryRun: input.dryRun,
        delayMs: input.delayMs,
        ...(input.goldenSetId ? { goldenSetId: input.goldenSetId } : {}),
      },
    });
    return {
      id: updated.id,
      suiteKey: updated.suiteKey ?? updated.id,
      agentProfileId: null,
    };
  }

  const created = await prisma.workflowTest.create({
    data: {
      userId,
      name: input.testName,
      dryRun: input.dryRun,
      delayMs: input.delayMs,
      suiteKey: input.suiteKey ?? undefined,
      goldenSetId: input.goldenSetId ?? undefined,
    },
  });

  const suiteKey = created.suiteKey ?? created.id;
  if (!created.suiteKey) {
    await prisma.workflowTest.update({
      where: { id: created.id },
      data: { suiteKey },
    });
  }

  return { id: created.id, suiteKey, agentProfileId: null };
}

export function toWorkflowTestSummary(test: {
  id: string;
  name: string;
  suiteKey: string | null;
  dryRun: boolean;
  delayMs: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: test.id,
    name: test.name,
    agentProfileId: null,
    databaseConnectionId: null,
    suiteKey: test.suiteKey,
    dryRun: test.dryRun,
    delayMs: test.delayMs,
    createdAt: test.createdAt.toISOString(),
    updatedAt: test.updatedAt.toISOString(),
    agent: {
      id: "env",
      name: loadEnv().DB_AGENT_MODEL_NAME,
      llmProvider: loadEnv().DB_AGENT_LLM_PROVIDER,
      modelName: loadEnv().DB_AGENT_MODEL_NAME,
    },
    database: null,
  };
}
