import { randomUUID } from "crypto";
import { extractSqlFromMarkdown } from "./agent.js";
import {
  buildAgentRunContext,
  buildFullDebugPayload,
  invokeResultDebugFields,
} from "./buildDebugPayload.js";
import { beginRequestDebug } from "./debugCapture.js";
import { extractMetricsFromDebug } from "./extractRunMetrics.js";
import { invokeWithHistory } from "./runAgentWithHistory.js";
import { insertWorkflowQueryExecution } from "./queryExecution.js";
import {
  analyzeStressRunResult,
  formatWorkflowAgentError,
  type QueryRunResult,
} from "./stressTestAnalyze.js";
import { connectionAgentInvokeInput } from "./userDatabase.js";
import type { profileAgentConfig } from "./userAgent.js";
import { enrichQueryRunResult } from "./workflowTestObservability.js";
import { subscribeWorkflowActivity } from "./workflowTestActivity.js";
import { isAbortError } from "../../utils/abort.js";

const EMPTY_METRICS = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  llmCallCount: 0,
  llmCalls: [] as Array<{
    node?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
  }>,
};

type QueryContext = {
  userId: string;
  dbType: DbType;
  activeDb: ActiveDb;
  dbInfo: DbInfo;
  agentConfig: AgentConfig;
  runnerOptions: RunnerOptions;
  dryRun: boolean;
  onActivity?: (message: string) => void;
  abortSignal?: AbortSignal;
};

function buildErrorDebugPayload(
  requestId: string,
  correlationId: string,
  dbInfo: DbInfo,
  query: string,
  dryRun: boolean,
  agentConfig: AgentConfig,
): unknown {
  try {
    const output = {
      markdownResponse: "",
      generatedSql: null,
      validationPassed: undefined,
      validationErrors: undefined,
      executionResult: undefined,
    };
    const runContext = buildAgentRunContext(query, dryRun, [], agentConfig, output);
    return buildFullDebugPayload(requestId, correlationId, dbInfo, runContext, {
      generatedSql: null,
      stateHistory: [],
    });
  } catch {
    return undefined;
  }
}

type RunnerOptions = ReturnType<typeof profileAgentConfig>;
type DbType = "postgres" | "mysql";

interface DbInfo {
  dbType: string;
  name: string;
  host: string;
}

interface AgentConfig {
  provider: string;
  model: string;
  readOnly: boolean;
  maxValidationRetries: number;
}

interface ActiveDb {
  id: string;
  dbType: string;
  dbUri: string;
  knowledgeDbUri?: string | null;
  dbMetadata?: unknown;
  businessContext?: string | null;
}

export interface QueryItem {
  groupName: string;
  query: string;
}

export async function executeQueryItem(
  item: QueryItem,
  context: QueryContext,
): Promise<{ result: QueryRunResult; metrics: ReturnType<typeof extractMetricsFromDebug>; ranAt: Date }> {
  if (context.abortSignal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  try {
    return await runQueryItem(item, context);
  } catch (err) {
    if (isAbortError(err)) throw err;

    const ranAt = new Date();
    const runResult = analyzeStressRunResult({
      query: item.query,
      groupName: item.groupName,
      durationMs: 0,
      dryRun: context.dryRun,
      errorMessage: formatWorkflowAgentError(err),
    });

    return {
      result: enrichQueryRunResult(runResult, EMPTY_METRICS, ranAt),
      metrics: EMPTY_METRICS,
      ranAt,
    };
  }
}

async function runQueryItem(
  item: QueryItem,
  context: QueryContext,
): Promise<{ result: QueryRunResult; metrics: ReturnType<typeof extractMetricsFromDebug>; ranAt: Date }> {
  const { groupName, query } = item;
  const {
    userId,
    dbType,
    activeDb,
    dbInfo,
    agentConfig,
    runnerOptions,
    dryRun,
    onActivity,
    abortSignal,
  } = context;

  const requestId = randomUUID();
  const correlationId = `workflow-${randomUUID()}`;
  beginRequestDebug(requestId, correlationId);

  const startedAt = Date.now();

  const unsubscribeActivity = onActivity
    ? subscribeWorkflowActivity(requestId, onActivity)
    : () => undefined;

  const heartbeat = onActivity
    ? setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        onActivity(`Working… ${seconds}s elapsed`);
      }, 2000)
    : undefined;

  const ranAt = new Date();
  let runResult: QueryRunResult;
  let debug: unknown;

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
        abortSignal,
        ...connectionAgentInvokeInput(activeDb, userId),
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

    debug = buildFullDebugPayload(
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
    if (isAbortError(err)) throw err;

    debug = buildErrorDebugPayload(
      requestId,
      correlationId,
      dbInfo,
      query,
      dryRun,
      agentConfig,
    );

    runResult = analyzeStressRunResult({
      query,
      groupName,
      durationMs: Date.now() - startedAt,
      dryRun,
      requestId,
      errorMessage: formatWorkflowAgentError(err),
      debug,
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    unsubscribeActivity();
  }

  const metrics = extractMetricsFromDebug(debug);
  const enriched = enrichQueryRunResult(runResult, metrics, ranAt);

  return { result: enriched, metrics, ranAt };
}

async function persistSingleWorkflowExecution(
  userId: string,
  runId: string,
  result: QueryRunResult,
): Promise<void> {
  const attempt = result.attempts?.[result.attempts.length - 1];
  if (!attempt) return;

  await insertWorkflowQueryExecution({
    userId,
    workflowTestRunId: runId,
    queryKey: result.queryKey ?? `${result.groupName}::${result.query}`,
    attemptNumber: attempt.attemptNumber,
    query: result.query,
    groupName: result.groupName,
    status: attempt.status,
    metrics: {
      promptTokens: attempt.promptTokens,
      completionTokens: attempt.completionTokens,
      totalTokens: attempt.totalTokens,
      llmCallCount: attempt.llmCalls.length,
      llmCalls: attempt.llmCalls,
    },
    durationMs: attempt.durationMs,
    requestId: attempt.requestId,
    ranAt: new Date(attempt.ranAt),
  });
}

export async function persistNewWorkflowExecutions(
  userId: string,
  runId: string,
  results: QueryRunResult[],
  fromIndex: number,
): Promise<number> {
  for (let index = fromIndex; index < results.length; index += 1) {
    await persistSingleWorkflowExecution(userId, runId, results[index]!);
  }
  return results.length;
}

export async function persistWorkflowExecutions(
  userId: string,
  runId: string,
  results: QueryRunResult[],
): Promise<void> {
  await persistNewWorkflowExecutions(userId, runId, results, 0);
}

export async function persistRerunExecutions(
  userId: string,
  runId: string,
  results: QueryRunResult[],
  previousExecutionCounts: Map<string, number>,
): Promise<void> {
  for (const result of results) {
    const attempts = result.attempts ?? [];
    const previousCount = previousExecutionCounts.get(result.queryKey ?? "") ?? 1;
    const newAttempts = attempts.slice(previousCount);
    for (const attempt of newAttempts) {
      await insertWorkflowQueryExecution({
        userId,
        workflowTestRunId: runId,
        queryKey: result.queryKey ?? `${result.groupName}::${result.query}`,
        attemptNumber: attempt.attemptNumber,
        query: result.query,
        groupName: result.groupName,
        status: attempt.status,
        metrics: {
          promptTokens: attempt.promptTokens,
          completionTokens: attempt.completionTokens,
          totalTokens: attempt.totalTokens,
          llmCallCount: attempt.llmCalls.length,
          llmCalls: attempt.llmCalls,
        },
        durationMs: attempt.durationMs,
        requestId: attempt.requestId,
        ranAt: new Date(attempt.ranAt),
      });
    }
  }
}
