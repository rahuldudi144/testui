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
  analyzeStressRunResult,
  buildStressTestSummary,
  type PlannedQueryItem,
  type QueryRunResult,
} from "../stressTestAnalyze.js";
import {
  parseDbHost,
  resolveDatabaseForWorkflowTest,
} from "../userDatabase.js";
import {
  expectedOutcomeToAgentOutcome,
  resolveExecution,
  resolveRerunItemPolicy,
  type ExecutionPolicyOverrides,
  type WorkflowExpectedOutcome,
  type WorkflowTestCategoryType,
} from "../workflowTestCategory.js";
import {
  DEFAULT_AVG_QUERY_MS,
  estimateRemainingMs,
  estimateTotalMs,
  resolveAvgQueryMs,
} from "../workflowTestEta.js";
import type { Message } from "../../../types/index.js";
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
  updateFailuresGroupPolicy,
} from "../workflowTestGroups.js";
import { authMiddleware } from "./auth.js";
import { errorMessage } from "../../../utils/errors.js";
import {
  formatFatalProviderStopMessage,
  isFatalProviderError,
} from "../fatalProviderError.js";
import { isAbortError } from "../../../utils/abort.js";
import { extractMetricsFromDebug } from "../extractRunMetrics.js";
import {
  enrichQueryRunResult,
  mergeRerunResults,
  normalizeQueryRunResult,
  normalizeRunReport,
  parseStoredResults,
  parseStoredSummary,
  selectFailedItemsForRerun,
  type RerunSetupGroup,
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
  finalizeOrphanedRunningRun,
  parsePlannedItems,
  resolveWatchPlannedTotal,
  type WorkflowRunCheckpointState,
} from "../workflowTestRunPersistence.js";
import {
  abortableDelay,
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
const EMPTY_METRICS = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  llmCallCount: 0,
  llmCalls: [],
};

type WorkflowStream = {
  writeSSE: (message: { event: string; data: string }) => Promise<void>;
  onAbort: (listener: () => void) => void;
};

async function loadAvgQueryMsForTest(
  userId: string,
  testId: string,
  suiteKey?: string | null,
): Promise<number> {
  const lastRun = await prisma.workflowTestRun.findFirst({
    where: { userId, workflowTestId: testId },
    orderBy: { ranAt: "desc" },
    select: { results: true },
  });

  const lastDurations = extractDurationsFromResults(lastRun?.results);

  let suiteDurations: number[] = [];
  if (suiteKey) {
    const suiteRuns = await prisma.workflowTestRun.findMany({
      where: {
        userId,
        workflowTest: { suiteKey },
      },
      orderBy: { ranAt: "desc" },
      take: 5,
      select: { results: true },
    });
    suiteDurations = suiteRuns.flatMap((run) =>
      extractDurationsFromResults(run.results),
    );
  }

  return resolveAvgQueryMs({
    lastRunDurations: lastDurations,
    suiteDurations,
    defaultMs: DEFAULT_AVG_QUERY_MS,
  });
}

function extractDurationsFromResults(results: unknown): number[] {
  if (!Array.isArray(results)) return [];
  return results
    .map((row) =>
      row && typeof row === "object" && typeof (row as { durationMs?: unknown }).durationMs === "number"
        ? (row as { durationMs: number }).durationMs
        : null,
    )
    .filter((n): n is number => n != null && n >= 0);
}

/** Attach category metadata from saved groups onto planned/remaining items. */
function enrichItemsWithCategory(
  items: Array<{ groupName: string; query: string }>,
  groups: WorkflowTestGroupRecord[],
): Array<{
  groupId: string;
  groupName: string;
  query: string;
  categoryType: WorkflowTestCategoryType;
  executionOverrides: import("../workflowTestCategory.js").ExecutionPolicyOverrides | null;
}> {
  const byKey = new Map<string, WorkflowTestGroupRecord>();
  for (const group of groups) {
    byKey.set(group.name, group);
  }

  return items.map((item) => {
    const group = byKey.get(item.groupName);
    return {
      groupId: group?.id ?? item.groupName,
      groupName: item.groupName,
      query: item.query,
      categoryType: group?.categoryType ?? "STANDARD",
      executionOverrides: group?.executionOverrides ?? null,
    };
  });
}

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
  databaseConnectionId?: string | null;
}

interface QueryLoopContext {
  userId: string;
  dbType: "postgres" | "mysql";
  activeDb: NonNullable<
    Awaited<ReturnType<typeof resolveDatabaseForWorkflowTest>>
  >;
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
  avgQueryMs: number;
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
  items: Array<{
    groupId: string;
    groupName: string;
    query: string;
    categoryType: WorkflowTestCategoryType;
    executionOverrides: import("../workflowTestCategory.js").ExecutionPolicyOverrides | null;
  }>,
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

  const estimatedTotalMs = estimateTotalMs({
    queryCount: plannedTotal,
    avgQueryMs: queryContext.avgQueryMs,
    delayMs: queryContext.delayMs,
  });

  await safeWriteSSE(stream, runId, {
    event: "start",
    data: JSON.stringify({
      ...startMeta,
      totalQueries: items.length,
      overallTotalQueries: plannedTotal,
      completedQueries: progressOffset,
      runId: checkpoint.runId,
      estimatedTotalMs,
    }),
  });

  let historyMessages: Message[] = [];
  let currentGroupId: string | null = null;
  const completedDurations: number[] = [];

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

    const item = items[index]!;
    const { groupId, groupName, query, categoryType, executionOverrides } = item;
    const policy = resolveExecution(categoryType, executionOverrides);

    if (currentGroupId !== groupId) {
      currentGroupId = groupId;
      historyMessages = [];
    }

    const messagesForInvoke =
      policy.history === "KEEP" ? [...historyMessages] : [];

    const itemDryRun = queryContext.dryRun;
    const itemDelayMs = queryContext.delayMs;

    const displayIndex = progressOffset + index + 1;
    const remainingQueries = plannedTotal - (displayIndex - 1);
    const rollingAvg =
      completedDurations.length > 0
        ? Math.round(
            completedDurations.reduce((a, b) => a + b, 0) /
              completedDurations.length,
          )
        : queryContext.avgQueryMs;
    const estimatedRemainingMs = estimateRemainingMs({
      remainingQueries,
      rollingAvgMs: rollingAvg,
      delayMs: itemDelayMs,
    });

    await safeWriteSSE(stream, runId, {
      event: "progress",
      data: JSON.stringify({
        groupName,
        queryIndex: displayIndex,
        totalQueries: plannedTotal,
        query,
        categoryType,
        expectedOutcome: policy.expectedOutcome,
        expectedResult: expectedOutcomeToAgentOutcome(policy.expectedOutcome),
        estimatedRemainingMs,
        estimatedTotalMs,
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

    const timeoutSignal =
      typeof policy.timeoutMs === "number" && policy.timeoutMs > 0
        ? AbortSignal.timeout(policy.timeoutMs)
        : undefined;
    const itemAbortSignal = combineAbortSignals(
      queryContext.abortSignal,
      timeoutSignal,
    );

    let runResult: QueryRunResult;
    try {
      const executed = await executeQueryItem(
        {
          groupName,
          query,
          categoryType,
          expectedOutcome: policy.expectedOutcome,
          messages: messagesForInvoke,
          history: policy.history,
          stopOnFailure: policy.stopOnFailure,
          timeoutMs: policy.timeoutMs,
        },
        { ...queryContext, dryRun: itemDryRun, abortSignal: itemAbortSignal },
      );
      runResult = executed.result;
    } catch (err) {
      if (isAbortError(err) && queryContext.abortSignal.aborted) {
        throw err;
      }
      if (isAbortError(err)) {
        runResult = enrichQueryRunResult(
          analyzeStressRunResult({
            query,
            groupName,
            durationMs: policy.timeoutMs ?? 0,
            dryRun: itemDryRun,
            errorMessage: `Query timed out after ${policy.timeoutMs ?? "?"}ms`,
            categoryType,
            expectedOutcome: policy.expectedOutcome,
            history: policy.history,
            stopOnFailure: policy.stopOnFailure,
            timeoutMs: policy.timeoutMs,
          }),
          EMPTY_METRICS,
          new Date(),
        );
      } else {
        throw err;
      }
    }

    completedDurations.push(runResult.durationMs);

    const fatalError =
      runResult.status === "error" && runResult.errorMessage
        ? new Error(runResult.errorMessage)
        : null;
    if (fatalError && isFatalProviderError(fatalError)) {
      checkpoint.results.push(runResult);
      await checkpointWorkflowRun(checkpoint, "partial", {
        dryRun: queryContext.dryRun,
        delayMs: queryContext.delayMs,
      });
      await safeWriteSSE(stream, runId, {
        event: "error",
        data: JSON.stringify({
          message: formatFatalProviderStopMessage(fatalError),
        }),
      });
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
      return "partial";
    }

    if (policy.history === "KEEP") {
      historyMessages = [
        ...historyMessages,
        { role: "user", content: query },
        {
          role: "assistant",
          content: runResult.markdownResponse ?? runResult.markdownPreview ?? "",
        },
      ];
    }

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

    if (
      policy.stopOnFailure &&
      (runResult.status === "fail" || runResult.status === "error")
    ) {
      queryContext.onActivity(
        `Stopping group "${groupName}" after failure (stopOnFailure).`,
      );
      // Skip remaining queries in this group only
      while (
        index + 1 < items.length &&
        items[index + 1]!.groupId === groupId
      ) {
        index += 1;
      }
    }

    if (itemDelayMs > 0 && index < items.length - 1) {
      await abortableDelay(itemDelayMs, queryContext.abortSignal);
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
  const {
    userId,
    testId,
    testName,
    groups,
    groupIds,
    dryRun,
    delayMs,
    agentProfileId,
    databaseConnectionId,
  } = options;

  const testRow = await prisma.workflowTest.findFirst({
    where: { id: testId, userId },
    select: { databaseConnectionId: true, suiteKey: true },
  });

  let activeDb: Awaited<ReturnType<typeof resolveDatabaseForWorkflowTest>>;
  try {
    activeDb = await resolveDatabaseForWorkflowTest(userId, {
      databaseConnectionId,
      testDatabaseConnectionId: testRow?.databaseConnectionId,
    });
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }

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

  const avgQueryMs = await loadAvgQueryMsForTest(userId, testId, testRow?.suiteKey);
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
  // Do not cancel on SSE disconnect — refresh must be able to reattach via /watch.
  // Explicit Cancel uses POST /runs/:runId/cancel.
  const abort = getRunAbort(savedRun.id)!;
  const runStream = wrapStreamForRun(savedRun.id, stream);
  const emitActivity = createActivityEmitter(stream, savedRun.id);

  const queryContext: QueryLoopContext = {
    userId,
    dbType,
    activeDb,
    dbInfo,
    agentConfig,
    runnerOptions,
    dryRun,
    delayMs,
    avgQueryMs,
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
    include: {
      workflowTest: {
        select: {
          agentProfileId: true,
          databaseConnectionId: true,
          suiteKey: true,
        },
      },
    },
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

  let activeDb: Awaited<ReturnType<typeof resolveDatabaseForWorkflowTest>>;
  try {
    activeDb = await resolveDatabaseForWorkflowTest(userId, {
      testDatabaseConnectionId: existingRun.workflowTest.databaseConnectionId,
    });
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }

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

  const avgQueryMs = await loadAvgQueryMsForTest(
    userId,
    existingRun.workflowTestId,
    existingRun.workflowTest.suiteKey,
  );
  const groups = await loadTestGroups(existingRun.workflowTestId);
  const remainingItems = enrichItemsWithCategory(remaining, groups);

  registerActiveRun(runId, userId);
  // Do not cancel on SSE disconnect — refresh reattaches via /watch.
  const abort = getRunAbort(runId)!;
  const runStream = wrapStreamForRun(runId, stream);
  const emitActivity = createActivityEmitter(stream, runId);
  const queryContext: QueryLoopContext = {
    userId,
    dbType,
    activeDb,
    dbInfo,
    agentConfig,
    runnerOptions,
    dryRun,
    delayMs,
    avgQueryMs,
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
    await runWorkflowQueryItems(remainingItems, {
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
  options?: {
    dryRun?: boolean;
    delayMs?: number;
    agentProfileId?: string | null;
    categoryType?: string;
    execution?: ExecutionPolicyOverrides | null;
    groups?: RerunSetupGroup[];
  },
): Promise<void> {
  const existingRun = await prisma.workflowTestRun.findFirst({
    where: { id: runId, userId },
    include: {
      workflowTest: {
        select: {
          agentProfileId: true,
          databaseConnectionId: true,
          suiteKey: true,
        },
      },
    },
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
  const failedSelections = selectFailedItemsForRerun(existingResults, {
    groups: options?.groups,
    categoryType: options?.categoryType,
    execution: options?.execution,
  });

  if (failedSelections.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No failed or errored queries to rerun in this report.",
      }),
    });
    return;
  }

  let activeDb: Awaited<ReturnType<typeof resolveDatabaseForWorkflowTest>>;
  try {
    activeDb = await resolveDatabaseForWorkflowTest(userId, {
      testDatabaseConnectionId: existingRun.workflowTest.databaseConnectionId,
    });
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }

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

  const requestedAgentId = options?.agentProfileId?.trim() || null;
  const resolvedAgent = await resolveWorkflowTestAgent(
    userId,
    requestedAgentId ??
      existingRun.agentProfileId ??
      existingRun.workflowTest.agentProfileId,
  );
  if (!resolvedAgent) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: requestedAgentId
          ? "Selected agent profile was not found."
          : "No agent profile configured for this test run.",
      }),
    });
    return;
  }

  const runnerOptions = resolvedAgent.runnerOptions;

  const dryRun = options?.dryRun ?? existingRun.dryRun;
  const delayMs = Math.max(0, options?.delayMs ?? existingRun.delayMs);

  const dbType = activeDb.dbType as "postgres" | "mysql";

  const env = loadEnv();
  const agentConfig = {
    provider: runnerOptions.llmProvider ?? env.DB_AGENT_LLM_PROVIDER,
    model: runnerOptions.modelName ?? env.DB_AGENT_MODEL_NAME,
    readOnly: env.DB_AGENT_READ_ONLY,
    maxValidationRetries: env.DB_AGENT_MAX_VALIDATION_RETRIES,
  };

  const avgQueryMs = await loadAvgQueryMsForTest(
    userId,
    existingRun.workflowTestId,
    existingRun.workflowTest.suiteKey,
  );

  registerActiveRun(runId, userId);
  // Do not cancel on SSE disconnect — refresh reattaches via /watch.
  const abort = getRunAbort(runId)!;
  const runStream = wrapStreamForRun(runId, stream);
  const emitActivity = createActivityEmitter(stream, runId);

  const dbInfo = {
    dbType: activeDb.dbType,
    name: activeDb.name,
    host: parseDbHost(activeDb.dbUri),
  };
  const queryContext = {
    userId,
    dbType,
    activeDb,
    dbInfo,
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
  const plannedItems = parsePlannedItems(existingRun.summary);
  const plannedCount =
    plannedItems.length > 0 ? plannedItems.length : existingResults.length;
  const passedBeforeRerun = existingResults.filter(
    (result) => result.status === "pass",
  ).length;

  await prisma.workflowTestRun.update({
    where: { id: runId },
    data: {
      agentProfileId: resolvedAgent.agent.id,
      agent: resolvedAgent.snapshot as unknown as Prisma.InputJsonValue,
      summary: buildWorkflowRunSummary(
        existingResults,
        plannedCount,
        "running",
        plannedItems.length > 0 ? plannedItems : undefined,
      ) as unknown as Prisma.InputJsonValue,
      results: existingResults as unknown as Prisma.InputJsonValue,
    },
  });

  await safeWriteSSE(stream, runId, {
    event: "start",
    data: JSON.stringify({
      testName: existingRun.testName,
      testId: existingRun.workflowTestId,
      totalQueries: failedSelections.length,
      overallTotalQueries: plannedCount,
      completedQueries: 0,
      dryRun,
      runId,
      rerun: true,
      resume: true,
      passedPreserved: passedBeforeRerun,
    }),
  });

  const reruns: Array<{
    queryKey: string;
    result: QueryRunResult;
    metrics: ReturnType<typeof extractMetricsFromDebug>;
    ranAt: Date;
  }> = [];
  let workingResults = existingResults;

  const syncPreviousExecutionCounts = () => {
    for (const result of workingResults) {
      const key = result.queryKey ?? `${result.groupName}::${result.query}`;
      previousExecutionCounts.set(
        key,
        result.executionCount ?? result.attempts?.length ?? 1,
      );
    }
  };

  const persistRerunState = async (
    runStatus: "running" | "completed" | "partial" | "cancelled",
  ) => {
    const summary =
      plannedItems.length > 0
        ? buildWorkflowRunSummary(
            workingResults,
            plannedItems.length,
            runStatus,
            plannedItems,
          )
        : {
            ...buildStressTestSummary(workingResults),
            runStatus,
            plannedQueries: plannedCount,
          };

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
    syncPreviousExecutionCounts();
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
        : {
            ...buildStressTestSummary(workingResults),
            runStatus,
            plannedQueries: plannedCount,
          };

    const report = normalizeRunReport({
      testId: existingRun.workflowTestId,
      runId,
      testName: existingRun.testName,
      dryRun,
      delayMs,
      database: dbInfo,
      ranAt: existingRun.ranAt.toISOString(),
      agent: resolvedAgent.snapshot,
      summary,
      results: workingResults,
    });

    await safeWriteSSE(stream, runId, {
      event: "complete",
      data: JSON.stringify(report),
    });
  };

  for (let index = 0; index < failedSelections.length; index += 1) {
    if (abort.isAborted()) {
      if (reruns.length > 0) {
        await persistRerunState("cancelled");
        await emitRerunComplete("cancelled");
      }
      return;
    }

    const selection = failedSelections[index]!;
    const item = selection.item;
    const queryKey = item.queryKey!;
    const policy = resolveRerunItemPolicy(item, selection.override);

    await safeWriteSSE(stream, runId, {
      event: "progress",
      data: JSON.stringify({
        groupName: item.groupName,
        queryIndex: index + 1,
        totalQueries: failedSelections.length,
        query: item.query,
        categoryType: policy.categoryType,
        expectedOutcome: policy.expectedOutcome,
      }),
    });
    emitActivity(`Query ${index + 1} of ${failedSelections.length} started`);

    if (abort.isAborted()) {
      if (reruns.length > 0) {
        await persistRerunState("cancelled");
        await emitRerunComplete("cancelled");
      }
      return;
    }

    const { result, metrics, ranAt } = await executeQueryItem(
      {
        groupName: item.groupName,
        query: item.query,
        categoryType: policy.categoryType,
        expectedOutcome: policy.expectedOutcome,
        history: policy.history,
        stopOnFailure: policy.stopOnFailure,
        timeoutMs: policy.timeoutMs,
      },
      queryContext,
    );

    reruns.push({ queryKey, result, metrics, ranAt });
    workingResults = mergeRerunResults(workingResults, [
      { queryKey, result, metrics, ranAt },
    ]);

    // Checkpoint after every merge so cancel/reconnect keeps newly passed rows.
    await persistRerunState(abort.isAborted() ? "cancelled" : "running");

    const mergedPreview = workingResults.find((row) => row.queryKey === queryKey);

    await safeWriteSSE(stream, runId, {
      event: "result",
      data: JSON.stringify(mergedPreview ?? result),
    });

    if (abort.isAborted()) {
      await emitRerunComplete("cancelled");
      return;
    }

    if (result.status === "error" || result.status === "fail") {
      const nodeLabel = result.failedNode ? ` at ${result.failedNode}` : "";
      emitActivity(`Query ${index + 1} failed${nodeLabel} — continuing`);
    }

    const fatalError =
      result.status === "error" && result.errorMessage
        ? new Error(result.errorMessage)
        : null;
    if (fatalError && isFatalProviderError(fatalError)) {
      await persistRerunState("partial");
      await safeWriteSSE(stream, runId, {
        event: "error",
        data: JSON.stringify({
          message: formatFatalProviderStopMessage(fatalError),
        }),
      });
      await emitRerunComplete("partial");
      return;
    }

    if (delayMs > 0 && index < failedSelections.length - 1) {
      await abortableDelay(delayMs, abort.signal);
    }
  }

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
  for (const run of runs) {
    if (parseStoredSummary(run.summary).runStatus !== "running") continue;
    if (isRunActive(run.id)) return run;
    await finalizeOrphanedRunningRun(run.id, userId);
  }
  return null;
}

async function executeWatchWorkflowTestRun(
  runId: string,
  userId: string,
  stream: WorkflowStream,
): Promise<void> {
  const healed = await finalizeOrphanedRunningRun(runId, userId);
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

  const summary = healed?.healed ? healed.summary : parseStoredSummary(run.summary);
  const results = healed?.healed ? healed.results : parseStoredResults(run.results);
  const plannedItems = parsePlannedItems(run.summary);
  const plannedTotal = resolveWatchPlannedTotal({
    plannedQueries: summary.plannedQueries,
    plannedItemsLength: plannedItems.length,
    resultsLength: results.length,
    summaryTotal: summary.total,
    runStatus: summary.runStatus,
  });
  const completedQueries =
    plannedTotal > 0
      ? Math.min(results.length, plannedTotal)
      : results.length;

  await stream.writeSSE({
    event: "start",
    data: JSON.stringify({
      testName: run.testName,
      testId: run.workflowTestId,
      totalQueries:
        plannedTotal > 0 ? Math.max(0, plannedTotal - results.length) : 0,
      overallTotalQueries: plannedTotal,
      completedQueries,
      dryRun: run.dryRun,
      runId: run.id,
      resume: true,
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

    const latest = await prisma.workflowTestRun.findFirst({
      where: { id: runId, userId },
    });
    if (latest) {
      const latestSummary = parseStoredSummary(latest.summary);
      const latestResults = parseStoredResults(latest.results);
      if (latestSummary.runStatus !== "running") {
        await stream.writeSSE({
          event: "complete",
          data: JSON.stringify(
            normalizeRunReport({
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
            }),
          ),
        });
      }
    }
    return;
  }

  // Status says running but no live executor — heal and complete (defensive).
  const orphan = await finalizeOrphanedRunningRun(runId, userId);
  const terminalSummary = orphan?.summary ?? summary;
  const terminalResults = orphan?.results ?? results;
  await stream.writeSSE({
    event: "complete",
    data: JSON.stringify(
      normalizeRunReport({
        testId: run.workflowTestId,
        runId: run.id,
        testName: run.testName,
        dryRun: run.dryRun,
        delayMs: run.delayMs,
        database: run.database as { dbType: string; name: string; host: string },
        ranAt: run.ranAt.toISOString(),
        agent: run.agent as WorkflowTestReportPayload["agent"],
        summary: terminalSummary,
        results: terminalResults,
      }),
    ),
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
      databaseConnection: {
        select: { id: true, name: true, dbType: true },
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
  if (cancelled) {
    return c.json({ ok: true });
  }

  // Run not in memory (refresh/server restart) — still mark DB so UI can stop.
  const healed = await finalizeOrphanedRunningRun(runId, user.id);
  if (healed?.healed || (healed && healed.summary.runStatus !== "running")) {
    return c.json({ ok: true, orphaned: true });
  }

  return c.json({ error: "No active workflow test run found to cancel." }, 404);
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

  await finalizeOrphanedRunningRun(runId, user.id);

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
    .catch((): { dryRun?: boolean; delayMs?: number } => ({}));

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
    .json<{
      dryRun?: boolean;
      delayMs?: number;
      agentProfileId?: string | null;
      categoryType?: string;
      execution?: ExecutionPolicyOverrides | null;
      groups?: RerunSetupGroup[];
    }>()
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
  const body = await c.req.json<{ runId?: string; groupName?: string }>();

  const runId = body.runId?.trim();
  if (!runId) {
    return c.json({ error: "runId is required." }, 400);
  }

  const test = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
  });
  if (!test) return c.json({ error: "Workflow test not found." }, 404);

  try {
    const result = await importFailuresFromRun(
      testId,
      runId,
      user.id,
      body.groupName,
    );
    return c.json(result);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 400);
  }
});

workflowTestRoutes.patch("/:testId/groups/failures/policy", async (c) => {
  const user = c.get("user");
  const testId = c.req.param("testId");
  const body = await c.req
    .json<{
      categoryType?: string;
      executionOverrides?: unknown;
    }>()
    .catch(() => ({}));

  const test = await prisma.workflowTest.findFirst({
    where: { id: testId, userId: user.id },
  });
  if (!test) return c.json({ error: "Workflow test not found." }, 404);

  try {
    const groups = await updateFailuresGroupPolicy(testId, {
      categoryType: body.categoryType,
      executionOverrides:
        body.executionOverrides === undefined
          ? undefined
          : (body.executionOverrides as
              | import("../workflowTestCategory.js").ExecutionPolicyOverrides
              | null),
    });
    return c.json({ groups });
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
    .catch((): { dryRun?: boolean; delayMs?: number } => ({}));

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
          databaseConnectionId: test.databaseConnectionId,
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
      databaseConnection: {
        select: { id: true, name: true, dbType: true },
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
    databaseConnectionId?: string | null;
    groups?: Array<{
      name?: string;
      queries?: string[] | string;
      categoryType?: string;
      execution?: unknown;
    }>;
    groupIds?: string[];
  }>();

  const testName = body.testName?.trim();
  if (!testName) {
    return c.json({ error: "A non-empty test name is required." }, 400);
  }

  const allManualGroups = normalizeGroups(body.groups ?? [], { keepEmpty: true });
  const runnableManualGroups = normalizeGroups(body.groups ?? []);
  const groupIds = body.groupIds?.filter(Boolean);

  if (!groupIds?.length && runnableManualGroups.length === 0) {
    return c.json({ error: "At least one query is required to run." }, 400);
  }

  const dryRun = body.dryRun ?? false;
  const delayMs = Math.max(0, body.delayMs ?? 0);
  const agentProfileId = body.agentProfileId?.trim() || null;
  const databaseConnectionId = body.databaseConnectionId?.trim() || null;

  const savedTest = await upsertWorkflowTest(user.id, {
    testName,
    agentProfileId,
    databaseConnectionId,
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

  if (allManualGroups.length > 0) {
    await saveManualGroups(savedTest.id, allManualGroups);
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
          databaseConnectionId,
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

function combineAbortSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): AbortSignal {
  if (!secondary) return primary;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([primary, secondary]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (primary.aborted || secondary.aborted) {
    controller.abort();
    return controller.signal;
  }
  primary.addEventListener("abort", onAbort, { once: true });
  secondary.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
