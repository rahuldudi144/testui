import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { prisma } from "../db.js";
import { extractSqlFromMarkdown } from "../agent.js";
import {
  buildAgentRunContext,
  buildFullDebugPayload,
  invokeResultDebugFields,
} from "../buildDebugPayload.js";
import { beginRequestDebug } from "../debugCapture.js";
import { loadEnv } from "../env.js";
import { invokeWithHistory } from "../runAgentWithHistory.js";
import {
  flattenGroupRecords,
  normalizeGroups,
  type WorkflowTestGroupRecord,
} from "../parseStressQueries.js";
import {
  analyzeStressRunResult,
  buildStressTestSummary,
  type QueryRunResult,
} from "../stressTestAnalyze.js";
import {
  getActiveDatabaseForUser,
  parseDbHost,
  connectionAgentMetadata,
} from "../userDatabase.js";
import { getActiveAgentForUser, profileAgentConfig } from "../userAgent.js";
import {
  ensureFailuresGroup,
  importFailuresFromRun,
  loadTestGroups,
  saveManualGroups,
} from "../workflowTestGroups.js";
import { authMiddleware } from "./auth.js";
import { errorMessage } from "../../../utils/errors.js";

type AuthUser = { id: string; username: string; createdAt: Date };

const STREAM_KEEPALIVE_MS = 5_000;

export const workflowTestRoutes = new Hono<{ Variables: { user: AuthUser } }>();

workflowTestRoutes.use("*", authMiddleware);

interface RunWorkflowTestOptions {
  userId: string;
  testId: string;
  testName: string;
  groups: WorkflowTestGroupRecord[];
  groupIds?: string[];
  dryRun: boolean;
  delayMs: number;
}

async function executeWorkflowTestRun(
  options: RunWorkflowTestOptions,
  stream: {
    writeSSE: (message: { event: string; data: string }) => Promise<void>;
  },
): Promise<void> {
  const { userId, testId, testName, groups, groupIds, dryRun, delayMs } =
    options;

  const activeDb = await getActiveDatabaseForUser(userId);
  if (!activeDb) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message:
          "No database configured. Add a PostgreSQL or MySQL connection in Settings.",
      }),
    });
    return;
  }

  const activeAgent = await getActiveAgentForUser(userId);
  const runnerOptions = profileAgentConfig(activeAgent);

  const items = flattenGroupRecords(groups, groupIds);
  if (items.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No queries to run for the selected group(s).",
      }),
    });
    return;
  }

  const dbType = activeDb.dbType as "postgres" | "mysql";
  const dbInfo = {
    dbType: activeDb.dbType,
    name: activeDb.name,
    host: parseDbHost(activeDb.dbUri),
  };

  const env = loadEnv();
  const agentConfig = {
    provider: runnerOptions.llmProvider ?? env.DB_AGENT_LLM_PROVIDER,
    model: runnerOptions.modelName ?? env.DB_AGENT_MODEL_NAME,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
  };

  const results: QueryRunResult[] = [];

  await stream.writeSSE({
    event: "start",
    data: JSON.stringify({
      testName,
      testId,
      totalQueries: items.length,
      dryRun,
    }),
  });

  for (let index = 0; index < items.length; index += 1) {
    const { groupName, query } = items[index]!;

    await stream.writeSSE({
      event: "progress",
      data: JSON.stringify({
        groupName,
        queryIndex: index + 1,
        totalQueries: items.length,
        query,
      }),
    });

    const requestId = randomUUID();
    const correlationId = `workflow-${randomUUID()}`;
    beginRequestDebug(requestId, correlationId);

    const startedAt = Date.now();
    let runResult: QueryRunResult;

    try {
      const { result, stateHistory } = await invokeWithHistory(
        dbType,
        activeDb.dbUri,
        {
          query,
          messages: [],
          dryRun,
          requestId,
          correlationId,
          ...connectionAgentMetadata(activeDb),
        },
        runnerOptions,
      );

      const generatedSql =
        result.generatedSql ?? extractSqlFromMarkdown(result.markdownResponse);

      const output = invokeResultDebugFields(result);
      const runContext = buildAgentRunContext(
        query,
        dryRun,
        [],
        agentConfig,
        output,
      );

      const debug = buildFullDebugPayload(
        requestId,
        correlationId,
        dbInfo,
        runContext,
        { generatedSql, stateHistory },
      );

      runResult = analyzeStressRunResult({
        query,
        groupName,
        result,
        debug,
        durationMs: Date.now() - startedAt,
        dryRun,
        requestId,
      });
    } catch (err) {
      runResult = analyzeStressRunResult({
        query,
        groupName,
        durationMs: Date.now() - startedAt,
        dryRun,
        requestId,
        errorMessage: errorMessage(err),
      });
    }

    results.push(runResult);

    await stream.writeSSE({
      event: "result",
      data: JSON.stringify(runResult),
    });

    if (delayMs > 0 && index < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const summary = buildStressTestSummary(results);
  const ranAt = new Date();

  const savedRun = await prisma.workflowTestRun.create({
    data: {
      userId,
      workflowTestId: testId,
      testName,
      dryRun,
      delayMs,
      database: dbInfo as unknown as Prisma.InputJsonValue,
      summary: summary as unknown as Prisma.InputJsonValue,
      results: results as unknown as Prisma.InputJsonValue,
      ranAt,
    },
  });

  await stream.writeSSE({
    event: "complete",
    data: JSON.stringify({
      testId,
      runId: savedRun.id,
      testName,
      dryRun,
      database: dbInfo,
      ranAt: ranAt.toISOString(),
      summary,
      results,
    }),
  });
}

workflowTestRoutes.get("/", async (c) => {
  const user = c.get("user");
  const tests = await prisma.workflowTest.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      runs: {
        orderBy: { ranAt: "desc" },
        take: 1,
        select: {
          id: true,
          ranAt: true,
          summary: true,
        },
      },
      _count: { select: { runs: true } },
    },
  });

  const testsWithGroups = await Promise.all(
    tests.map(async (test) => ({
      id: test.id,
      name: test.name,
      dryRun: test.dryRun,
      delayMs: test.delayMs,
      groups: await loadTestGroups(test.id),
      createdAt: test.createdAt.toISOString(),
      updatedAt: test.updatedAt.toISOString(),
      runCount: test._count.runs,
      lastRun: test.runs[0]
        ? {
            id: test.runs[0].id,
            ranAt: test.runs[0].ranAt.toISOString(),
            summary: test.runs[0].summary,
          }
        : null,
    })),
  );

  return c.json({ tests: testsWithGroups });
});

workflowTestRoutes.get("/runs/:runId", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");

  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId: user.id },
  });

  if (!run) return c.json({ error: "Workflow test run not found." }, 404);

  return c.json({
    report: {
      testId: run.workflowTestId,
      runId: run.id,
      testName: run.testName,
      dryRun: run.dryRun,
      database: run.database,
      ranAt: run.ranAt.toISOString(),
      summary: run.summary,
      results: run.results,
    },
  });
});

workflowTestRoutes.post("/:testId/groups/failures/import", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");
  const body = await c.req.json<{ runId?: string }>();

  const runId = body.runId?.trim();
  if (!runId) {
    return c.json({ error: "runId is required." }, 400);
  }

  const test = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
  });
  if (!test) return c.json({ error: "Workflow test not found." }, 404);

  try {
    const result = await importFailuresFromRun(testId, runId, user.id);
    return c.json(result);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

workflowTestRoutes.post("/:testId/groups/:groupId/run", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");
  const groupId = c.req.param("groupId");
  const body = await c.req
    .json<{ dryRun?: boolean; delayMs?: number }>()
    .catch(() => ({}));

  const test = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
  });
  if (!test) return c.json({ error: "Workflow test not found." }, 404);

  const groups = await loadTestGroups(testId);
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    return c.json({ error: "Workflow test group not found." }, 404);
  }

  const dryRun = body.dryRun ?? test.dryRun;
  const delayMs = Math.max(0, body.delayMs ?? test.delayMs);

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, STREAM_KEEPALIVE_MS);

    try {
      await executeWorkflowTestRun(
        {
          userId: user.id,
          testId: test.id,
          testName: test.name,
          groups,
          groupIds: [groupId],
          dryRun,
          delayMs,
        },
        stream,
      );
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: errorMessage(err) }),
      });
    } finally {
      clearInterval(keepAlive);
    }
  });
});

workflowTestRoutes.get("/:testId", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");

  const test = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
    include: {
      runs: {
        orderBy: { ranAt: "desc" },
        take: 20,
        select: {
          id: true,
          ranAt: true,
          dryRun: true,
          summary: true,
        },
      },
    },
  });

  if (!test) return c.json({ error: "Workflow test not found." }, 404);

  return c.json({
    test: {
      id: test.id,
      name: test.name,
      dryRun: test.dryRun,
      delayMs: test.delayMs,
      groups: await loadTestGroups(test.id),
      createdAt: test.createdAt.toISOString(),
      updatedAt: test.updatedAt.toISOString(),
      runs: test.runs.map((run) => ({
        id: run.id,
        ranAt: run.ranAt.toISOString(),
        dryRun: run.dryRun,
        summary: run.summary,
      })),
    },
  });
});

workflowTestRoutes.delete("/:testId", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");

  const existing = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
  });
  if (!existing) return c.json({ error: "Workflow test not found." }, 404);

  await prisma.workflowTest.delete({ where: { id: testId } });
  return c.json({ ok: true });
});

workflowTestRoutes.post("/run", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    testName?: string;
    dryRun?: boolean;
    delayMs?: number;
    groups?: Array<{ name?: string; queries?: string[] | string }>;
    groupIds?: string[];
  }>();

  const testName = body.testName?.trim();
  if (!testName) {
    return c.json({ error: "A non-empty test name is required." }, 400);
  }

  const manualGroups = normalizeGroups(body.groups ?? []);
  const groupIds = body.groupIds?.filter(Boolean);

  if (!groupIds?.length && manualGroups.length === 0) {
    return c.json(
      { error: "At least one group with a name and queries is required." },
      400,
    );
  }

  const dryRun = body.dryRun ?? false;
  const delayMs = Math.max(0, body.delayMs ?? 0);

  const savedTest = await prisma.workflowTest.upsert({
    where: {
      userId_name: { userId: user.id, name: testName },
    },
    create: {
      userId: user.id,
      name: testName,
      dryRun,
      delayMs,
    },
    update: {
      dryRun,
      delayMs,
    },
  });

  if (manualGroups.length > 0) {
    await saveManualGroups(savedTest.id, manualGroups);
  } else {
    await ensureFailuresGroup(savedTest.id);
  }

  const groups = await loadTestGroups(savedTest.id);

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, STREAM_KEEPALIVE_MS);

    try {
      await executeWorkflowTestRun(
        {
          userId: user.id,
          testId: savedTest.id,
          testName,
          groups,
          groupIds,
          dryRun,
          delayMs,
        },
        stream,
      );
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: errorMessage(err) }),
      });
    } finally {
      clearInterval(keepAlive);
    }
  });
});
