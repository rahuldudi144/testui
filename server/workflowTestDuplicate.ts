import { prisma } from "./db.js";
import { saveManualGroups } from "./workflowTestGroups.js";
import type { WorkflowTestGroupRecord } from "./parseStressQueries.js";

export interface DuplicateWorkflowTestInput {
  sourceTestId: string;
  userId: string;
  agentProfileId: string;
  testName?: string;
}

export interface DuplicateWorkflowTestResult {
  test: {
    id: string;
    name: string;
    agentProfileId: string;
    suiteKey: string;
    dryRun: boolean;
    delayMs: number;
  };
  groups: WorkflowTestGroupRecord[];
}

export async function duplicateWorkflowTestForAgent(
  input: DuplicateWorkflowTestInput,
): Promise<DuplicateWorkflowTestResult> {
  const { sourceTestId, userId, agentProfileId } = input;

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

  const targetAgent = await prisma.agentProfile.findFirst({
    where: { id: agentProfileId, userId },
  });
  if (!targetAgent) {
    throw new Error("Agent profile not found.");
  }

  const suiteKey = source.suiteKey ?? source.id;
  const defaultName = `${source.name} — ${targetAgent.name}`;
  const testName = input.testName?.trim() || defaultName;

  const existing = await prisma.workflowTest.findFirst({
    where: { userId, name: testName, agentProfileId },
  });
  if (existing) {
    throw new Error(
      `A test named "${testName}" already exists for this agent.`,
    );
  }

  const manualGroups = source.groups.map((group) => ({
    name: group.name,
    queries: group.queries.map((query) => query.query),
  }));

  const created = await prisma.workflowTest.create({
    data: {
      userId,
      name: testName,
      agentProfileId,
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
      agentProfileId,
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
    agentProfileId?: string | null;
    dryRun: boolean;
    delayMs: number;
    suiteKey?: string | null;
  },
): Promise<{ id: string; suiteKey: string }> {
  const existing = await prisma.workflowTest.findFirst({
    where: {
      userId,
      name: input.testName,
      agentProfileId: input.agentProfileId ?? null,
    },
  });

  if (existing) {
    const updated = await prisma.workflowTest.update({
      where: { id: existing.id },
      data: {
        dryRun: input.dryRun,
        delayMs: input.delayMs,
      },
    });
    return {
      id: updated.id,
      suiteKey: updated.suiteKey ?? updated.id,
    };
  }

  const created = await prisma.workflowTest.create({
    data: {
      userId,
      name: input.testName,
      agentProfileId: input.agentProfileId ?? null,
      dryRun: input.dryRun,
      delayMs: input.delayMs,
      suiteKey: input.suiteKey ?? undefined,
    },
  });

  const suiteKey = created.suiteKey ?? created.id;
  if (!created.suiteKey) {
    await prisma.workflowTest.update({
      where: { id: created.id },
      data: { suiteKey },
    });
  }

  return { id: created.id, suiteKey };
}

export function toWorkflowTestSummary(test: {
  id: string;
  name: string;
  agentProfileId: string | null;
  suiteKey: string | null;
  dryRun: boolean;
  delayMs: number;
  createdAt: Date;
  updatedAt: Date;
  agentProfile?: {
    id: string;
    name: string;
    llmProvider: string | null;
    modelName: string | null;
  } | null;
}) {
  return {
    id: test.id,
    name: test.name,
    agentProfileId: test.agentProfileId,
    suiteKey: test.suiteKey,
    dryRun: test.dryRun,
    delayMs: test.delayMs,
    createdAt: test.createdAt.toISOString(),
    updatedAt: test.updatedAt.toISOString(),
    agent: test.agentProfile
      ? {
          id: test.agentProfile.id,
          name: test.agentProfile.name,
          llmProvider: test.agentProfile.llmProvider,
          modelName: test.agentProfile.modelName,
        }
      : null,
  };
}
