import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { prisma } from "../db.js";
import { loadEnv } from "../env.js";
import {
  flattenGroupRecords,
  normalizeGroups,
  type WorkflowTestGroupRecord,
} from "../parseStressQueries.js";
import {
  buildStressTestSummary,
  type PlannedQueryItem,
  type QueryRunResult,
} from "../stressTestAnalyze.js";
import {
  getActiveDatabaseForUser,
  parseDbHost,
} from "../userDatabase.js";
import {
  duplicateWorkflowTestForAgent,
  toWorkflowTestSummary,
  upsertWorkflowTest,
} from "../workflowTestDuplicate.js";
import { resolveWorkflowTestAgent } from "../workflowTestAgent.js";
import type { profileAgentConfig } from "../userAgent.js";
import {
  ensureFailuresGroup,
  importFailuresFromRun,
  loadTestGroups,
  saveManualGroups,
} from "../workflowTestGroups.js";
import { authMiddleware } from "./auth.js";
import { errorMessage } from "../../../utils/errors.js";
import { isAbortError } from "../../../utils/abort.js";
import { extractMetricsFromDebug } from "../extractRunMetrics.js";
import {
  collectFailedForRerun,
  mergeRerunResults,
  normalizeQueryRunResult,
  normalizeRunReport,
  parseStoredResults,
  parseStoredSummary,
  type WorkflowTestReportPayload,
} from "../workflowTestObservability.js";
import {
  executeQueryItem,
  persistRerunExecutions,
} from "../workflowTestRunExecutor.js";
import {
  buildWorkflowRunSummary,
  checkpointWorkflowRun,
  collectRemainingItems,
  parsePlannedItems,
  type WorkflowRunCheckpointState,
} from "../workflowTestRunPersistence.js";
import {
  cancelActiveRun,
  createActivityEmitterForRun,
  findActiveRunIdForUser,
  getRunAbort,
  isRunActive,
  registerActiveRun,
  subscribeRunEvents,
  unregisterActiveRun,
  waitForRunEnd,
  wrapStreamForRun,
  safeWriteSSE,
  type RunStreamEvent,
} from "../workflowTestRunManager.js";

type AuthUser = { id: string; username: string; createdAt: Date };

const STREAM_KEEPALIVE_MS = 5_000;

type WorkflowStream = {
  writeSSE: (message: { event: string; data: string }) => Promise<void>;
  onAbort: (listener: () => void) => void;
};

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
  agentProfileId?: string | null;
}

interface QueryLoopContext {
  dbType: "postgres" | "mysql";
  activeDb: NonNullable<Awaited<ReturnType<typeof getActiveDatabaseForUser>>>;
  dbInfo: { dbType: string; name: string; host: string };
  agentConfig: {
    provider: string;
    model: string;
    readOnly: boolean;
    maxValidationRetries: number;
  };
  runnerOptions: ReturnType<typeof profileAgentConfig>;
  dryRun: boolean;
  delayMs: number;
  onActivity: (message: string) => void;
  abortSignal: AbortSignal;
}

function createActivityEmitter(
  stream: WorkflowStream,
  runId?: string,
): (message: string) => void {
  if (runId) {
    return createActivityEmitterForRun(runId, stream);
  }
  let chain = Promise.resolve();
  return (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    chain = chain.then(() =>
      stream.writeSSE({
        event: "status",
        data: JSON.stringify({ message: trimmed }),
      }),
    );
    void chain;
  };
}

async function emitWorkflowRunComplete(
  stream: WorkflowStream,
  runId: string | undefined,
  fields: {
    testId: string;
    runId: string;
    testName: string;
    dryRun: boolean;
    delayMs: number;
    database: { dbType: string; name: string; host: string };
    ranAt: string;
    agent: WorkflowTestReportPayload["agent"];
    summary: ReturnType<typeof buildWorkflowRunSummary>;
    results: QueryRunResult[];
  },
): Promise<void> {
  const report = normalizeRunReport(fields);
  const message: RunStreamEvent = {
    event: "complete",
    data: JSON.stringify(report),
  };
  if (runId) {
    await safeWriteSSE(stream, runId, message);
  } else {
    await stream.writeSSE(message);
  }
}

async function runWorkflowQueryItems(
  items: Array<{ groupName: string; query: string }>,
  options: {
    stream: WorkflowStream;
    runId: string;
    abort: { isAborted: () => boolean };
    queryContext: QueryLoopContext;
    checkpoint: WorkflowRunCheckpointState;
    progressOffset: number;
    plannedTotal: number;
    startMeta: Record<string, unknown>;
    reportFields: Omit<
      Parameters<typeof emitWorkflowRunComplete>[2],
      "summary" | "results"
    >;
  },
): Promise<"completed" | "cancelled" | "partial"> {
  const {
    stream,
    runId,
    abort,
    queryContext,
    checkpoint,
    progressOffset,
    plannedTotal,
    startMeta,
    reportFields,
  } = options;

  await safeWriteSSE(stream, runId, {
    event: "start",
    data: JSON.stringify({
      ...startMeta,
      totalQueries: items.length,
      overallTotalQueries: plannedTotal,
      completedQueries: progressOffset,
      runId: checkpoint.runId,
    }),
  });

  for (let index = 0; index < items.length; index += 1) {
    if (abort.isAborted()) {
      await checkpointWorkflowRun(checkpoint, "cancelled", {
        dryRun: queryContext.dryRun,
        delayMs: queryContext.delayMs,
      });
      await emitWorkflowRunComplete(stream, runId, {
        ...reportFields,
        summary: buildWorkflowRunSummary(
          checkpoint.results,
          checkpoint.plannedItems.length,
          "cancelled",
          checkpoint.plannedItems,
        ),
        results: checkpoint.results,
      });
      return "cancelled";
    }

    const { groupName, query } = items[index]!;
    const displayIndex = progressOffset + index + 1;

    await safeWriteSSE(stream, runId, {
      event: "progress",
      data: JSON.stringify({
        groupName,
        queryIndex: displayIndex,
        totalQueries: plannedTotal,
        query,
      }),
    });
    queryContext.onActivity(
      `Query ${displayIndex} of ${plannedTotal} started`,
    );

    if (abort.isAborted()) {
      await checkpointWorkflowRun(checkpoint, "cancelled", {
        dryRun: queryContext.dryRun,
        delayMs: queryContext.delayMs,
      });
      await emitWorkflowRunComplete(stream, runId, {
        ...reportFields,
        summary: buildWorkflowRunSummary(
          checkpoint.results,
          checkpoint.plannedItems.length,
          "cancelled",
          checkpoint.plannedItems,
        ),
        results: checkpoint.results,
      });
      return "cancelled";
    }

    const { result: runResult } = await executeQueryItem(
      { groupName, query },
      queryContext,
    );

    if (abort.isAborted()) {
      checkpoint.results.push(runResult);
      await checkpointWorkflowRun(checkpoint, "cancelled", {
        dryRun: queryContext.dryRun,
        delayMs: queryContext.delayMs,
      });
      await emitWorkflowRunComplete(stream, runId, {
        ...reportFields,
        summary: buildWorkflowRunSummary(
          checkpoint.results,
          checkpoint.plannedItems.length,
          "cancelled",
          checkpoint.plannedItems,
        ),
        results: checkpoint.results,
      });
      return "cancelled";
    }

    if (runResult.status === "error" || runResult.status === "fail") {
      const nodeLabel = runResult.failedNode ? ` at ${runResult.failedNode}` : "";
      queryContext.onActivity(
        `Query ${displayIndex} failed${nodeLabel} — continuing`,
      );
    }

    checkpoint.results.push(runResult);

    await checkpointWorkflowRun(checkpoint, "running", {
      dryRun: queryContext.dryRun,
      delayMs: queryContext.delayMs,
    });

    await safeWriteSSE(stream, runId, {
      event: "result",
      data: JSON.stringify(runResult),
    });

    if (queryContext.delayMs > 0 && index < items.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, queryContext.delayMs),
      );
    }
  }

  const finalStatus =
    checkpoint.results.length >= checkpoint.plannedItems.length
      ? "completed"
      : "partial";

  await checkpointWorkflowRun(checkpoint, finalStatus, {
    dryRun: queryContext.dryRun,
    delayMs: queryContext.delayMs,
  });

  await emitWorkflowRunComplete(stream, runId, {
    ...reportFields,
    summary: buildWorkflowRunSummary(
      checkpoint.results,
      checkpoint.plannedItems.length,
      finalStatus,
      checkpoint.plannedItems,
    ),
    results: checkpoint.results,
  });

  return finalStatus;
}

async function executeWorkflowTestRun(
  options: RunWorkflowTestOptions,
  stream: WorkflowStream,
): Promise<void> {
  const { userId, testId, testName, groups, groupIds, dryRun, delayMs, agentProfileId } =
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

  const resolvedAgent = await resolveWorkflowTestAgent(userId, agentProfileId);
  if (!resolvedAgent) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: agentProfileId
          ? "Selected agent profile was not found."
          : "Select an agent for this test before running.",
      }),
    });
    return;
  }

  const runnerOptions = resolvedAgent.runnerOptions;

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

  const plannedItems: PlannedQueryItem[] = items.map(({ groupName, query }) => ({
    groupName,
    query,
  }));
  const ranAt = new Date();
  const initialSummary = buildWorkflowRunSummary(
    [],
    plannedItems.length,
    "running",
    plannedItems,
  );

  const savedRun = await prisma.workflowTestRun.create({
    data: {
      userId,
      workflowTestId: testId,
      agentProfileId: resolvedAgent.snapshot.id,
      agent: resolvedAgent.snapshot as unknown as Prisma.InputJsonValue,
      testName,
      dryRun,
      delayMs,
      database: dbInfo as unknown as Prisma.InputJsonValue,
      summary: initialSummary as unknown as Prisma.InputJsonValue,
      results: [] as unknown as Prisma.InputJsonValue,
      ranAt,
    },
  });

  registerActiveRun(savedRun.id, userId);
  const abort = getRunAbort(savedRun.id)!;
  const runStream = wrapStreamForRun(savedRun.id, stream);
  const emitActivity = createActivityEmitter(stream, savedRun.id);

  const queryContext: QueryLoopContext = {
    dbType,
    activeDb,
    dbInfo,
    agentConfig,
    runnerOptions,
    dryRun,
    delayMs,
    onActivity: emitActivity,
    abortSignal: abort.signal,
  };

  const checkpoint: WorkflowRunCheckpointState = {
    runId: savedRun.id,
    userId,
    results: [],
    plannedItems,
    persistedCount: 0,
  };

  const reportFields = {
    testId,
    runId: savedRun.id,
    testName,
    dryRun,
    delayMs,
    database: dbInfo,
    ranAt: ranAt.toISOString(),
    agent: resolvedAgent.snapshot,
  };

  try {
    await runWorkflowQueryItems(items, {
      stream: runStream,
      runId: savedRun.id,
      abort,
      queryContext,
      checkpoint,
      progressOffset: 0,
      plannedTotal: plannedItems.length,
      startMeta: { testName, testId, dryRun },
      reportFields,
    });
  } catch (err) {
    if (checkpoint.results.length > 0 && !isAbortError(err)) {
      await checkpointWorkflowRun(checkpoint, "partial", { dryRun, delayMs });
      await emitWorkflowRunComplete(stream, savedRun.id, {
        ...reportFields,
        summary: buildWorkflowRunSummary(
          checkpoint.results,
          checkpoint.plannedItems.length,
          "partial",
          checkpoint.plannedItems,
        ),
        results: checkpoint.results,
      });
      return;
    }
    throw err;
  } finally {
    unregisterActiveRun(savedRun.id);
  }
}

async function executeResumeWorkflowTestRun(
  runId: string,
  userId: string,
  stream: WorkflowStream,
  options?: { dryRun?: boolean; delayMs?: number },
): Promise<void> {
  const existingRun = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId },
    include: { workflowTest: { select: { agentProfileId: true } } },
  });

  if (!existingRun) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: "Workflow test run not found." }),
    });
    return;
  }

  const existingResults = parseStoredResults(existingRun.results).map(
    normalizeQueryRunResult,
  );
  const plannedItems = parsePlannedItems(existingRun.summary);

  if (plannedItems.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message:
          "This run cannot be resumed because it has no saved query plan. Start a new test instead.",
      }),
    });
    return;
  }

  const remaining = collectRemainingItems(plannedItems, existingResults);
  if (remaining.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "All queries in this run have already completed.",
      }),
    });
    return;
  }

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

  const resolvedAgent = await resolveWorkflowTestAgent(
    userId,
    existingRun.agentProfileId ?? existingRun.workflowTest.agentProfileId,
  );
  if (!resolvedAgent) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No agent profile configured for this test run.",
      }),
    });
    return;
  }

  const runnerOptions = resolvedAgent.runnerOptions;
  const dryRun = options?.dryRun ?? existingRun.dryRun;
  const delayMs = Math.max(0, options?.delayMs ?? existingRun.delayMs);
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

  registerActiveRun(runId, userId);
  const abort = getRunAbort(runId)!;
  const runStream = wrapStreamForRun(runId, stream);
  const emitActivity = createActivityEmitter(stream, runId);
  const queryContext: QueryLoopContext = {
    dbType,
    activeDb,
    dbInfo,
    agentConfig,
    runnerOptions,
    dryRun,
    delayMs,
    onActivity: emitActivity,
    abortSignal: abort.signal,
  };

  const checkpoint: WorkflowRunCheckpointState = {
    runId,
    userId,
    results: [...existingResults],
    plannedItems,
    persistedCount: existingResults.length,
  };

  const reportFields = {
    testId: existingRun.workflowTestId,
    runId,
    testName: existingRun.testName,
    dryRun,
    delayMs,
    database: dbInfo,
    ranAt: existingRun.ranAt.toISOString(),
    agent:
      (existingRun.agent as WorkflowTestReportPayload["agent"]) ??
      resolvedAgent.snapshot,
  };

  try {
    await runWorkflowQueryItems(remaining, {
      stream: runStream,
      runId,
      abort,
      queryContext,
      checkpoint,
      progressOffset: existingResults.length,
      plannedTotal: plannedItems.length,
      startMeta: {
        testName: existingRun.testName,
        testId: existingRun.workflowTestId,
        dryRun,
        resume: true,
      },
      reportFields,
    });
  } catch (err) {
    if (checkpoint.results.length > 0 && !isAbortError(err)) {
      await checkpointWorkflowRun(checkpoint, "partial", { dryRun, delayMs });
      await emitWorkflowRunComplete(stream, runId, {
        ...reportFields,
        summary: buildWorkflowRunSummary(
          checkpoint.results,
          checkpoint.plannedItems.length,
          "partial",
          checkpoint.plannedItems,
        ),
        results: checkpoint.results,
      });
      return;
    }
    throw err;
  } finally {
    unregisterActiveRun(runId);
  }
}

async function executeRerunFailuresInRun(
  runId: string,
  userId: string,
  stream: WorkflowStream,
  options?: { dryRun?: boolean; delayMs?: number },
): Promise<void> {
  const existingRun = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId },
    include: { workflowTest: { select: { agentProfileId: true } } },
  });

  if (!existingRun) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: "Workflow test run not found." }),
    });
    return;
  }

  const existingResults = parseStoredResults(existingRun.results).map(
    normalizeQueryRunResult,
  );
  const failedItems = collectFailedForRerun(existingResults);

  if (failedItems.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No failed or errored queries to rerun in this report.",
      }),
    });
    return;
  }

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

  const resolvedAgent = await resolveWorkflowTestAgent(
    userId,
    existingRun.agentProfileId ?? existingRun.workflowTest.agentProfileId,
  );
  if (!resolvedAgent) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No agent profile configured for this test run.",
      }),
    });
    return;
  }

  const runnerOptions = resolvedAgent.runnerOptions;

  const dryRun = options?.dryRun ?? existingRun.dryRun;
  const delayMs = Math.max(0, options?.delayMs ?? existingRun.delayMs);

  const dbType = activeDb.dbType as "postgres" | "mysql";
  const dbInfo = existingRun.database as {
    dbType: string;
    name: string;
    host: string;
  };

  const env = loadEnv();
  const agentConfig = {
    provider: runnerOptions.llmProvider ?? env.DB_AGENT_LLM_PROVIDER,
    model: runnerOptions.modelName ?? env.DB_AGENT_MODEL_NAME,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
  };

  registerActiveRun(runId, userId);
  const abort = getRunAbort(runId)!;
  const runStream = wrapStreamForRun(runId, stream);
  const emitActivity = createActivityEmitter(stream, runId);

  const queryContext = {
    dbType,
    activeDb,
    dbInfo: {
      dbType: activeDb.dbType,
      name: activeDb.name,
      host: parseDbHost(activeDb.dbUri),
    },
    agentConfig,
    runnerOptions,
    dryRun,
    onActivity: emitActivity,
    abortSignal: abort.signal,
  };

  const previousExecutionCounts = new Map(
    existingResults.map((result) => [
      result.queryKey ?? `${result.groupName}::${result.query}`,
      result.executionCount ?? result.attempts?.length ?? 1,
    ]),
  );

  try {
  await safeWriteSSE(stream, runId, {
    event: "start",
    data: JSON.stringify({
      testName: existingRun.testName,
      testId: existingRun.workflowTestId,
      totalQueries: failedItems.length,
      dryRun,
      runId,
      rerun: true,
    }),
  });

  const reruns: Array<{
    queryKey: string;
    result: QueryRunResult;
    metrics: ReturnType<typeof extractMetricsFromDebug>;
    ranAt: Date;
  }> = [];
  let workingResults = existingResults;
  const plannedItems = parsePlannedItems(existingRun.summary);

  const persistRerunState = async (
    runStatus: "completed" | "partial" | "cancelled",
  ) => {
    const summary =
      plannedItems.length > 0
        ? buildWorkflowRunSummary(
            workingResults,
            plannedItems.length,
            runStatus,
            plannedItems,
          )
        : buildStressTestSummary(workingResults);

    await prisma.workflowTestRun.update({
      where: { id: runId },
      data: {
        dryRun,
        delayMs,
        summary: summary as unknown as Prisma.InputJsonValue,
        results: workingResults as unknown as Prisma.InputJsonValue,
      },
    });

    await persistRerunExecutions(
      userId,
      runId,
      workingResults,
      previousExecutionCounts,
    );
  };

  const emitRerunComplete = async (
    runStatus: "completed" | "partial" | "cancelled",
  ) => {
    const summary =
      plannedItems.length > 0
        ? buildWorkflowRunSummary(
            workingResults,
            plannedItems.length,
            runStatus,
            plannedItems,
          )
        : buildStressTestSummary(workingResults);

    const report = normalizeRunReport({
      testId: existingRun.workflowTestId,
      runId,
      testName: existingRun.testName,
      dryRun,
      delayMs,
      database: dbInfo,
      ranAt: existingRun.ranAt.toISOString(),
      agent:
        (existingRun.agent as {
          id: string;
          name: string;
          llmProvider: string | null;
          modelName: string | null;
        } | null) ?? resolvedAgent.snapshot,
      summary,
      results: workingResults,
    });

    await stream.writeSSE({
      event: "complete",
      data: JSON.stringify(report),
    });
  };

  for (let index = 0; index < failedItems.length; index += 1) {
    if (abort.isAborted()) {
      if (reruns.length > 0) {
        await persistRerunState("cancelled");
        await emitRerunComplete("cancelled");
      }
      return;
    }

    const item = failedItems[index]!;
    const queryKey = item.queryKey!;

    await stream.writeSSE({
      event: "progress",
      data: JSON.stringify({
        groupName: item.groupName,
        queryIndex: index + 1,
        totalQueries: failedItems.length,
        query: item.query,
      }),
    });
    emitActivity(`Query ${index + 1} of ${failedItems.length} started`);

    if (abort.isAborted()) {
      await persistRerunState("cancelled");
      await emitRerunComplete("cancelled");
      return;
    }

    const { result, metrics, ranAt } = await executeQueryItem(
      { groupName: item.groupName, query: item.query },
      queryContext,
    );

    if (abort.isAborted()) {
      reruns.push({ queryKey, result, metrics, ranAt });
      workingResults = mergeRerunResults(workingResults, [
        { queryKey, result, metrics, ranAt },
      ]);
      await persistRerunState("cancelled");
      await emitRerunComplete("cancelled");
      return;
    }

    if (result.status === "error" || result.status === "fail") {
      const nodeLabel = result.failedNode ? ` at ${result.failedNode}` : "";
      emitActivity(`Query ${index + 1} failed${nodeLabel} — continuing`);
    }

    reruns.push({ queryKey, result, metrics, ranAt });
    workingResults = mergeRerunResults(workingResults, [
      { queryKey, result, metrics, ranAt },
    ]);

    const mergedPreview = workingResults.find((row) => row.queryKey === queryKey);

    await safeWriteSSE(stream, runId, {
      event: "result",
      data: JSON.stringify(mergedPreview ?? result),
    });

    if (delayMs > 0 && index < failedItems.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const mergedResults = workingResults;
  await persistRerunState("completed");
  await emitRerunComplete("completed");
  } finally {
    unregisterActiveRun(runId);
  }
}

async function findDbActiveRunForUser(userId: string) {
  const runs = await prisma.workflowTestRun.findMany({
    where: { userId },
    orderBy: { ranAt: "desc" },
    take: 30,
  });
  return (
    runs.find((run) => parseStoredSummary(run.summary).runStatus === "running") ??
    null
  );
}

async function executeWatchWorkflowTestRun(
  runId: string,
  userId: string,
  stream: WorkflowStream,
): Promise<void> {
  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId },
  });
  if (!run) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: "Workflow test run not found." }),
    });
    return;
  }

  const summary = parseStoredSummary(run.summary);
  const results = parseStoredResults(run.results);
  const plannedItems = parsePlannedItems(run.summary);
  const plannedTotal = summary.plannedQueries ?? plannedItems.length;

  await stream.writeSSE({
    event: "start",
    data: JSON.stringify({
      testName: run.testName,
      testId: run.workflowTestId,
      totalQueries: Math.max(0, plannedTotal - results.length),
      overallTotalQueries: plannedTotal,
      completedQueries: results.length,
      dryRun: run.dryRun,
      runId: run.id,
      resume: results.length > 0,
    }),
  });

  for (const result of results) {
    await stream.writeSSE({
      event: "result",
      data: JSON.stringify(result),
    });
  }

  if (summary.runStatus !== "running") {
    const report = normalizeRunReport({
      testId: run.workflowTestId,
      runId: run.id,
      testName: run.testName,
      dryRun: run.dryRun,
      delayMs: run.delayMs,
      database: run.database as { dbType: string; name: string; host: string },
      ranAt: run.ranAt.toISOString(),
      agent: run.agent as WorkflowTestReportPayload["agent"],
      summary,
      results,
    });
    await stream.writeSSE({
      event: "complete",
      data: JSON.stringify(report),
    });
    return;
  }

  if (isRunActive(runId)) {
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      void stream.writeSSE(event).catch(() => undefined);
    });
    stream.onAbort(() => unsubscribe());
    await waitForRunEnd(runId);
    return;
  }

  let lastCount = results.length;
  const poll = setInterval(async () => {
    const latest = await prisma.workflowTestRun.findFirst({
      where: { id: runId, userId },
    });
    if (!latest) {
      clearInterval(poll);
      return;
    }
    const latestResults = parseStoredResults(latest.results);
    const latestSummary = parseStoredSummary(latest.summary);
    for (let i = lastCount; i < latestResults.length; i += 1) {
      await stream.writeSSE({
        event: "result",
        data: JSON.stringify(latestResults[i]),
      }).catch(() => undefined);
    }
    lastCount = latestResults.length;
    if (latestSummary.runStatus !== "running") {
      clearInterval(poll);
      const report = normalizeRunReport({
        testId: latest.workflowTestId,
        runId: latest.id,
        testName: latest.testName,
        dryRun: latest.dryRun,
        delayMs: latest.delayMs,
        database: latest.database as {
          dbType: string;
          name: string;
          host: string;
        },
        ranAt: latest.ranAt.toISOString(),
        agent: latest.agent as WorkflowTestReportPayload["agent"],
        summary: latestSummary,
        results: latestResults,
      });
      await stream.writeSSE({
        event: "complete",
        data: JSON.stringify(report),
      }).catch(() => undefined);
    }
  }, 2000);

  stream.onAbort(() => clearInterval(poll));
  await new Promise<void>((resolve) => {
    const checkDone = setInterval(async () => {
      const latest = await prisma.workflowTestRun.findFirst({
        where: { id: runId, userId },
      });
      if (!latest) {
        clearInterval(checkDone);
        clearInterval(poll);
        resolve();
        return;
      }
      if (parseStoredSummary(latest.summary).runStatus !== "running") {
        clearInterval(checkDone);
        resolve();
      }
    }, 2000);
    stream.onAbort(() => {
      clearInterval(checkDone);
      clearInterval(poll);
      resolve();
    });
  });
}

workflowTestRoutes.get("/", async (c) => {
  const user = c.get("user");
  const tests = await prisma.workflowTest.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      agentProfile: {
        select: { id: true, name: true, llmProvider: true, modelName: true },
      },
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
      ...toWorkflowTestSummary(test),
      groups: await loadTestGroups(test.id),
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

workflowTestRoutes.get("/runs/active", async (c) => {
  const user = c.get("user");
  const inMemoryRunId = findActiveRunIdForUser(user.id);
  if (inMemoryRunId) {
    const run = await prisma.workflowTestRun.findFirst({
      where: { id: inMemoryRunId, userId: user.id },
    });
    if (run) {
      return c.json({
        run: {
          id: run.id,
          testName: run.testName,
          testId: run.workflowTestId,
          summary: parseStoredSummary(run.summary),
          resultCount: parseStoredResults(run.results).length,
        },
      });
    }
  }

  const dbRun = await findDbActiveRunForUser(user.id);
  if (!dbRun) {
    return c.json({ run: null });
  }

  return c.json({
    run: {
      id: dbRun.id,
      testName: dbRun.testName,
      testId: dbRun.workflowTestId,
      summary: parseStoredSummary(dbRun.summary),
      resultCount: parseStoredResults(dbRun.results).length,
    },
  });
});

workflowTestRoutes.post("/runs/:runId/cancel", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");
  const cancelled = cancelActiveRun(runId, user.id);
  if (!cancelled) {
    return c.json({ error: "No active workflow test run found to cancel." }, 404);
  }
  return c.json({ ok: true });
});

workflowTestRoutes.get("/runs/:runId/watch", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, STREAM_KEEPALIVE_MS);

    try {
      await executeWatchWorkflowTestRun(runId, user.id, stream);
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

workflowTestRoutes.get("/runs/:runId", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");

  const run = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId: user.id },
  });

  if (!run) return c.json({ error: "Workflow test run not found." }, 404);

  const report = normalizeRunReport({
    testId: run.workflowTestId,
    runId: run.id,
    testName: run.testName,
    dryRun: run.dryRun,
    delayMs: run.delayMs,
    database: run.database as { dbType: string; name: string; host: string },
    ranAt: run.ranAt.toISOString(),
    agent: run.agent as WorkflowTestReportPayload["agent"],
    summary: parseStoredSummary(run.summary),
    results: parseStoredResults(run.results),
  });

  return c.json({ report });
});

workflowTestRoutes.post("/runs/:runId/resume", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");
  const body = await c.req
    .json<{ dryRun?: boolean; delayMs?: number }>()
    .catch(() => ({}));

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, STREAM_KEEPALIVE_MS);

    try {
      await executeResumeWorkflowTestRun(runId, user.id, stream, body);
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

workflowTestRoutes.post("/runs/:runId/rerun-failures", async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");
  const body = await c.req
    .json<{ dryRun?: boolean; delayMs?: number }>()
    .catch(() => ({}));

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "{}" });
    }, STREAM_KEEPALIVE_MS);

    try {
      await executeRerunFailuresInRun(runId, user.id, stream, body);
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

  if (!test.agentProfileId) {
    return c.json(
      { error: "This saved test has no agent. Assign an agent in Setup before running." },
      400,
    );
  }

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
          agentProfileId: test.agentProfileId,
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
      agentProfile: {
        select: { id: true, name: true, llmProvider: true, modelName: true },
      },
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
      ...toWorkflowTestSummary(test),
      groups: await loadTestGroups(test.id),
      runs: test.runs.map((run) => ({
        id: run.id,
        ranAt: run.ranAt.toISOString(),
        dryRun: run.dryRun,
        summary: run.summary,
      })),
    },
  });
});

workflowTestRoutes.post("/:testId/duplicate", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");
  const body = await c.req.json<{
    agentProfileId?: string;
    testName?: string;
  }>();

  const agentProfileId = body.agentProfileId?.trim();
  if (!agentProfileId) {
    return c.json({ error: "agentProfileId is required." }, 400);
  }

  try {
    const result = await duplicateWorkflowTestForAgent({
      sourceTestId: testId,
      userId: user.id,
      agentProfileId,
      testName: body.testName,
    });
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
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
    agentProfileId?: string | null;
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
  const agentProfileId = body.agentProfileId?.trim() || null;

  const savedTest = await upsertWorkflowTest(user.id, {
    testName,
    agentProfileId,
    dryRun,
    delayMs,
  });

  const resolvedAgentForRun = await resolveWorkflowTestAgent(
    user.id,
    agentProfileId ?? savedTest.agentProfileId,
  );
  if (!resolvedAgentForRun) {
    return c.json(
      { error: "Select an agent for this test before running." },
      400,
    );
  }

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
          agentProfileId: agentProfileId ?? savedTest.agentProfileId,
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
