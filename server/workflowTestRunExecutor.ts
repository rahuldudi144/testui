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
  type QueryRunResult,
} from "./stressTestAnalyze.js";
import { connectionAgentMetadata } from "./userDatabase.js";
import type { profileAgentConfig } from "./userAgent.js";
import { enrichQueryRunResult } from "./workflowTestObservability.js";
import { errorMessage } from "../../utils/errors.js";

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
  dbType: string;
  dbUri: string;
  dbMetadata?: unknown;
  businessContext?: string | null;
}

export interface QueryItem {
  groupName: string;
  query: string;
}

export async function executeQueryItem(
  item: QueryItem,
  context: {
    dbType: DbType;
    activeDb: ActiveDb;
    dbInfo: DbInfo;
    agentConfig: AgentConfig;
    runnerOptions: RunnerOptions;
    dryRun: boolean;
  },
): Promise<{ result: QueryRunResult; metrics: ReturnType<typeof extractMetricsFromDebug>; ranAt: Date }> {
  const { groupName, query } = item;
  const { dbType, activeDb, dbInfo, agentConfig, runnerOptions, dryRun } =
    context;

  const requestId = randomUUID();
  const correlationId = `workflow-${randomUUID()}`;
  beginRequestDebug(requestId, correlationId);

  const startedAt = Date.now();
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
    debug = undefined;
    runResult = analyzeStressRunResult({
      query,
      groupName,
      durationMs: Date.now() - startedAt,
      dryRun,
      requestId,
      errorMessage: errorMessage(err),
    });
  }

  const metrics = extractMetricsFromDebug(debug);
  const enriched = enrichQueryRunResult(runResult, metrics, ranAt);

  return { result: enriched, metrics, ranAt };
}

export async function persistWorkflowExecutions(
  userId: string,
  runId: string,
  results: QueryRunResult[],
): Promise<void> {
  for (const result of results) {
    const attempt = result.attempts?.[result.attempts.length - 1];
    if (!attempt) continue;

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
