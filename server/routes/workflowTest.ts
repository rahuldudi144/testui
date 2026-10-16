import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { prisma } from "../db.js";
import { loadEnv } from "../env.js";
import {
  flattenGroupRecords,
  configuredEntryCount,
  normalizeGroups,
  suiteImportError,
  type WorkflowTestGroupRecord,
} from "../parseStressQueries.js";
import {
  analyzeStressRunResult,
  buildStressTestSummary,
  isInfraErrorMessage,
  type PlannedQueryItem,
  type QueryRunResult,
} from "../stressTestAnalyze.js";
import { envQuerySetup, schemaContextSummary } from "../queryTarget.js";
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
import type { AgentConfigOverrides } from "../agent.js";
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
  createGoldenSet,
  loadGoldenRunContext,
  preflightStoredGolden,
  type GoldenRunContext,
} from "../golden/goldenHttp.js";
import { sha256Text } from "../golden/preflight.js";
import {
  clampRepeats,
  expandRepeatItems,
  infraBackoffMs,
  isInfraForRetry,
  markDbModified,
  readDbSnapshot,
  scoreWorkflowResult,
  snapshotsDiffer,
  withGoldenSummary,
  type QueryInvokeCapture,
} from "../golden/scoreRun.js";
import { buildQueryKey } from "../workflowTestObservability.js";
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
  goldenSetId?: string | null;
  repeats?: number;
  retryInfra?: boolean;
  stopOnCircuitBreaker?: boolean;
  fingerprintStatus?: string | null;
  goldenFileHash?: string | null;
  suiteFileHash?: string | null;
}

interface QueryLoopContext {
  userId: string;
  dbType: "postgres" | "mysql";
  activeDb: ReturnType<typeof envQuerySetup>["activeDb"];
  dbInfo: { dbType: string; name: string; host: string };
  agentConfig: {
    provider: string;
    model: string;
    readOnly: boolean;
    maxValidationRetries: number;
  };
  runnerOptions: AgentConfigOverrides;
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
  let summary = withGoldenSummary(fields.summary, fields.results, null);
  if (runId) {
    const row = await prisma.workflowTestRun
      .findUnique({ where: { id: runId }, select: { repeats: true } })
      .catch(() => null);
    if (row && row.repeats > 1) summary = { ...summary, repeats: row.repeats };
  }
  const report = normalizeRunReport({ ...fields, summary });
  if (runId) {
    const infraErrorCount = fields.results.filter(
      (result) =>
        result.goldenStatus === "INFRA_ERROR" || result.actualOutcome === "infra_error",
    ).length;
    await prisma.workflowTestRun
      .update({
        where: { id: runId },
        data: {
          infraErrorCount,
          ...(summary.stopReason ? { stopReason: summary.stopReason } : {}),
        },
      })
      .catch(() => undefined);
  }
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
    runIndex?: number;
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
    golden?: GoldenRunContext | null;
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
    golden,
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
  let priorSql: string[] = [];
  let currentGroupId: string | null = null;
  let consecutiveInfraErrors = 0;
  const completedDurations: number[] = [];
  let snapshotBefore: Awaited<ReturnType<typeof readDbSnapshot>> = null;
  let snapshotGroup = "";

  async function finishGroupSnapshot(): Promise<void> {
    if (!snapshotBefore || !golden) {
      snapshotBefore = null;
      return;
    }
    const before = snapshotBefore;
    const groupName = snapshotGroup;
    snapshotBefore = null;
    try {
      const after = await readDbSnapshot(golden.scoringDbUri, golden.schema);
      if (after && snapshotsDiffer(before, after)) {
        const watched = new Set(
          [...golden.byKey.values()]
            .filter((item) => item.assert_db_unchanged && item.group === groupName)
            .map((item) => item.queryKey),
        );
        markDbModified(checkpoint.results, groupName, watched);
      }
    } catch {
      snapshotBefore = null;
    }
  }

  for (let index = 0; index < items.length; index += 1) {
    if (abort.isAborted()) {
      await finishGroupSnapshot();
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
    const runIndex = item.runIndex ?? 1;
    const policy = resolveExecution(categoryType, executionOverrides);

    if (currentGroupId !== groupId) {
      await finishGroupSnapshot();
      currentGroupId = groupId;
      historyMessages = [];
      priorSql = [];
      if (golden?.snapshotGroups.has(groupName)) {
        snapshotGroup = groupName;
        snapshotBefore = await readDbSnapshot(golden.scoringDbUri, golden.schema).catch(
          () => null,
        );
      }
    }

    const messagesForInvoke =
      policy.history === "KEEP" ? [...historyMessages] : [];
    const priorSqlForInvoke = policy.history === "KEEP" ? [...priorSql] : [];

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
      await finishGroupSnapshot();
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

    const maxExtra = golden ? (golden.retryInfra ? 2 : 0) : 2;
    let runResult: QueryRunResult | undefined;
    let capture: QueryInvokeCapture | null = null;
    let goldenAttempts = 1;
    for (let attempt = 0; attempt <= maxExtra; attempt += 1) {
      if (attempt > 0 && golden?.retryInfra) {
        await abortableDelay(infraBackoffMs(attempt - 1), queryContext.abortSignal);
      }
      try {
        const executed = await executeQueryItem(
          {
            groupName,
            query,
            categoryType,
            expectedOutcome: policy.expectedOutcome,
            messages: messagesForInvoke,
            priorSql: priorSqlForInvoke,
            history: policy.history,
            stopOnFailure: policy.stopOnFailure,
            timeoutMs: policy.timeoutMs,
          },
          { ...queryContext, dryRun: itemDryRun, abortSignal: itemAbortSignal },
        );
        runResult = executed.result;
        capture = executed.capture;
        goldenAttempts = attempt + 1;
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

      const infra =
        runResult.actualOutcome === "infra_error" ||
        isInfraErrorMessage(runResult.errorMessage) ||
        isInfraForRetry(runResult, capture);
      if (!infra || attempt === maxExtra) break;
    }
    if (!runResult) {
      throw new Error("Query did not produce a result.");
    }
    if (golden) {
      runResult = await scoreWorkflowResult({
        result: runResult,
        capture,
        item: golden.byKey.get(buildQueryKey(groupName, query)),
        runIndex,
        goldenAttempts,
        scoringDbUri: golden.scoringDbUri,
      });
    } else {
      runResult = { ...runResult, runIndex };
    }

    completedDurations.push(runResult.durationMs);

    const infraFailure =
      runResult.goldenStatus === "INFRA_ERROR" ||
      runResult.actualOutcome === "infra_error" ||
      isInfraErrorMessage(runResult.errorMessage);
    consecutiveInfraErrors = infraFailure ? consecutiveInfraErrors + 1 : 0;
    const stopOnCircuit = golden ? golden.stopOnCircuitBreaker : true;
    if (consecutiveInfraErrors >= 5 && stopOnCircuit) {
      checkpoint.results.push(runResult);
      await finishGroupSnapshot();
      await checkpointWorkflowRun(checkpoint, "partial", {
        dryRun: queryContext.dryRun,
        delayMs: queryContext.delayMs,
      });
      await safeWriteSSE(stream, runId, {
        event: "error",
        data: JSON.stringify({
          message: "Stopped after 5 consecutive infrastructure errors.",
        }),
      });
      await emitWorkflowRunComplete(stream, runId, {
        ...reportFields,
        summary: {
          ...buildWorkflowRunSummary(
            checkpoint.results,
            checkpoint.plannedItems.length,
            "partial",
            checkpoint.plannedItems,
          ),
          stopReason: "infra_circuit_breaker",
        },
        results: checkpoint.results,
      });
      return "partial";
    }

    const fatalError =
      runResult.status === "error" && runResult.errorMessage
        ? new Error(runResult.errorMessage)
        : null;
    if (fatalError && isFatalProviderError(fatalError)) {
      checkpoint.results.push(runResult);
      await finishGroupSnapshot();
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

    const nextItem = items[index + 1];
    const lastOfQuery =
      !nextItem || nextItem.groupId !== groupId || nextItem.query !== query;
    if (policy.history === "KEEP" && lastOfQuery) {
      const limit = loadEnv().ASK_CHAT_HISTORY_MESSAGE_LIMIT;
      const nextHistory: Message[] = [
        ...historyMessages,
        { role: "user", content: query },
        {
          role: "assistant",
          content: runResult.markdownResponse ?? runResult.markdownPreview ?? "",
        },
      ];
      historyMessages = nextHistory.slice(limit > 0 ? -limit : 0);
      if (runResult.generatedSql) {
        priorSql = [...priorSql, runResult.generatedSql].slice(limit > 0 ? -limit : 0);
      }
    }

    if (abort.isAborted()) {
      checkpoint.results.push(runResult);
      await finishGroupSnapshot();
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

  await finishGroupSnapshot();

  const expectedResults = checkpoint.plannedItems.length * (golden?.repeats ?? 1);
  const finalStatus =
    checkpoint.results.length >= expectedResults ? "completed" : "partial";

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
  } = options;

  const testRow = await prisma.workflowTest.findFirst({
    where: { id: testId, userId },
    select: { suiteKey: true },
  });

  let setup: ReturnType<typeof envQuerySetup>;
  try {
    setup = envQuerySetup();
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }
  const { activeDb, dbType, dbInfo, agentConfig, runnerOptions, snapshot } = setup;

  const sourceItems = flattenGroupRecords(groups, groupIds);
  if (sourceItems.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "No queries to run for the selected group(s).",
      }),
    });
    return;
  }

  const repeats = clampRepeats(options.repeats ?? 1);
  const golden = options.goldenSetId
    ? await loadGoldenRunContext(userId, options.goldenSetId, {
        repeats,
        retryInfra: options.retryInfra !== false,
        stopOnCircuitBreaker: options.stopOnCircuitBreaker !== false,
      })
    : null;
  const items = expandRepeatItems(sourceItems, golden ? repeats : 1, []);
  const avgQueryMs = await loadAvgQueryMsForTest(userId, testId, testRow?.suiteKey);
  const plannedItems: PlannedQueryItem[] = sourceItems.map(({ groupName, query }) => ({
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
      agent: snapshot as unknown as Prisma.InputJsonValue,
      testName,
      dryRun,
      delayMs,
      database: dbInfo as unknown as Prisma.InputJsonValue,
      summary: initialSummary as unknown as Prisma.InputJsonValue,
      results: [] as unknown as Prisma.InputJsonValue,
      fingerprintStatus: options.fingerprintStatus ?? null,
      repeats: golden ? repeats : 1,
      infraErrorCount: 0,
      goldenFileHash: options.goldenFileHash ?? golden?.fileHash ?? null,
      suiteFileHash: options.suiteFileHash ?? null,
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
    agent: snapshot,
  };

  try {
    await runWorkflowQueryItems(items, {
      stream: runStream,
      runId: savedRun.id,
      abort,
      queryContext,
      checkpoint,
      progressOffset: 0,
      plannedTotal: items.length,
      startMeta: { testName, testId, dryRun },
      golden,
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
          suiteKey: true,
          goldenSetId: true,
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

  const repeats = clampRepeats(existingRun.repeats ?? 1);
  const remaining = collectRemainingItems(plannedItems, existingResults, repeats);
  if (remaining.length === 0) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({
        message: "All queries in this run have already completed.",
      }),
    });
    return;
  }

  let setup: ReturnType<typeof envQuerySetup>;
  try {
    setup = envQuerySetup();
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }
  const { activeDb, dbType, dbInfo, agentConfig, runnerOptions, snapshot } = setup;
  const dryRun = options?.dryRun ?? existingRun.dryRun;
  const delayMs = Math.max(0, options?.delayMs ?? existingRun.delayMs);

  const avgQueryMs = await loadAvgQueryMsForTest(
    userId,
    existingRun.workflowTestId,
    existingRun.workflowTest.suiteKey,
  );
  const groups = await loadTestGroups(existingRun.workflowTestId);
  const golden = existingRun.workflowTest.goldenSetId
    ? await loadGoldenRunContext(userId, existingRun.workflowTest.goldenSetId, {
        repeats,
        retryInfra: true,
        stopOnCircuitBreaker: true,
      })
    : null;
  const remainingItems = expandRepeatItems(
    enrichItemsWithCategory(remaining, groups),
    repeats,
    existingResults,
  );

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
      (existingRun.agent as WorkflowTestReportPayload["agent"]) ?? snapshot,
  };

  try {
    await runWorkflowQueryItems(remainingItems, {
      stream: runStream,
      runId,
      abort,
      queryContext,
      checkpoint,
      progressOffset: existingResults.length,
      plannedTotal: plannedItems.length * repeats,
      startMeta: {
        testName: existingRun.testName,
        testId: existingRun.workflowTestId,
        dryRun,
        resume: true,
      },
      golden,
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
          suiteKey: true,
          goldenSetId: true,
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

  let setup: ReturnType<typeof envQuerySetup>;
  try {
    setup = envQuerySetup();
  } catch (error) {
    await stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: errorMessage(error) }),
    });
    return;
  }
  const { activeDb, dbType, dbInfo, agentConfig, runnerOptions, snapshot } = setup;

  const dryRun = options?.dryRun ?? existingRun.dryRun;
  const delayMs = Math.max(0, options?.delayMs ?? existingRun.delayMs);

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
      agent: snapshot as unknown as Prisma.InputJsonValue,
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
      agent: snapshot,
      summary,
      results: workingResults,
    });

    await safeWriteSSE(stream, runId, {
      event: "complete",
      data: JSON.stringify(report),
    });
  };

  const rerunGolden = existingRun.workflowTest.goldenSetId
    ? await loadGoldenRunContext(userId, existingRun.workflowTest.goldenSetId, {
        repeats: 1,
        retryInfra: false,
        stopOnCircuitBreaker: true,
      })
    : null;

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

    const executed = await executeQueryItem(
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
    const metrics = executed.metrics;
    const ranAt = executed.ranAt;
    const result = rerunGolden
      ? await scoreWorkflowResult({
          result: executed.result,
          capture: executed.capture,
          item: rerunGolden.byKey.get(buildQueryKey(item.groupName, item.query)),
          runIndex: executed.result.runIndex ?? 1,
          goldenAttempts: 1,
          scoringDbUri: rerunGolden.scoringDbUri,
        })
      : executed.result;

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

workflowTestRoutes.post("/golden", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string; content?: unknown }>();
  const stored = await createGoldenSet(user.id, body);
  if (stored.errors.length > 0) {
    return c.json({ error: stored.errors.join(" "), ...stored }, 400);
  }
  return c.json(stored);
});

workflowTestRoutes.post("/preflight", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    goldenSetId?: string;
    groups?: Array<{ name?: string; queries?: unknown }>;
  }>();
  const goldenSetId = body.goldenSetId?.trim();
  if (!goldenSetId) {
    return c.json({ error: "A golden answer set is required." }, 400);
  }
  const importError = suiteImportError(body.groups ?? []);
  const groups = importError ? body.groups ?? [] : normalizeGroups(body.groups ?? []);
  const preflight = await preflightStoredGolden({
    userId: user.id,
    goldenSetId,
    groups,
  });
  if ("error" in preflight) {
    return c.json({ error: preflight.error }, 400);
  }
  if (importError) {
    preflight.checks = preflight.checks.map((check) =>
      check.id === "suite" ? { ...check, status: "block", messages: [importError] } : check,
    );
    preflight.blocked = true;
    preflight.onlyFingerprintBlocked = false;
  }
  return c.json({ ...preflight, agentSchema: schemaContextSummary() });
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
    testName?: string;
  }>();

  try {
    const result = await duplicateWorkflowTestForAgent({
      sourceTestId: testId,
      userId: user.id,
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
    queryCount?: number;
    groupIds?: string[];
    goldenSetId?: string | null;
    repeats?: number;
    retryInfra?: boolean;
    stopOnCircuitBreaker?: boolean;
    fingerprintOverride?: boolean;
    suiteFileHash?: string | null;
  }>();

  const testName = body.testName?.trim();
  if (!testName) {
    return c.json({ error: "A non-empty test name is required." }, 400);
  }

  const importError = suiteImportError(body.groups ?? []);
  if (importError) {
    return c.json({ error: importError }, 400);
  }

  const allManualGroups = normalizeGroups(body.groups ?? [], { keepEmpty: true });
  const runnableManualGroups = normalizeGroups(body.groups ?? []);
  const plannedCount = runnableManualGroups.reduce(
    (total, group) => total + group.queries.length,
    0,
  );
  const configuredCount = (body.groups ?? []).reduce((total, group) => {
    if (!group.name?.trim()) return total;
    return total + configuredEntryCount(group.queries);
  }, 0);
  if (
    configuredCount !== plannedCount ||
    (typeof body.queryCount === "number" && body.queryCount !== plannedCount)
  ) {
    const configured =
      typeof body.queryCount === "number" ? body.queryCount : configuredCount;
    return c.json(
      {
        error: `Planned query count ${plannedCount} does not match configured count ${configured}.`,
      },
      400,
    );
  }
  const groupIds = body.groupIds?.filter(Boolean);

  if (!groupIds?.length && runnableManualGroups.length === 0) {
    return c.json({ error: "At least one query is required to run." }, 400);
  }

  const dryRun = body.dryRun ?? false;
  const delayMs = Math.max(0, body.delayMs ?? 0);

  const goldenSetId = body.goldenSetId?.trim() || null;
  const repeats = clampRepeats(body.repeats ?? 1);
  let fingerprintStatus: string | null = null;
  let goldenFileHash: string | null = null;
  if (goldenSetId) {
    const preflight = await preflightStoredGolden({
      userId: user.id,
      goldenSetId,
      groups: runnableManualGroups,
    });
    if ("error" in preflight) {
      return c.json({ error: preflight.error }, 400);
    }
    const blocked =
      preflight.blocked && !(body.fingerprintOverride && preflight.onlyFingerprintBlocked);
    if (blocked) {
      return c.json(
        { error: "Preflight blocked the run.", preflight },
        400,
      );
    }
    fingerprintStatus = preflight.fingerprintStatus;
    const owned = await prisma.goldenSet.findFirst({
      where: { id: goldenSetId, userId: user.id },
      select: { fileHash: true },
    });
    goldenFileHash = owned?.fileHash ?? null;
  }

  const savedTest = await upsertWorkflowTest(user.id, {
    testName,
    dryRun,
    delayMs,
    goldenSetId,
  });

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
          goldenSetId,
          repeats,
          retryInfra: body.retryInfra !== false,
          stopOnCircuitBreaker: body.stopOnCircuitBreaker !== false,
          fingerprintStatus,
          goldenFileHash,
          suiteFileHash:
            body.suiteFileHash?.trim() || sha256Text(JSON.stringify(body.groups ?? [])),
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
