import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import type { AttemptTokenMetrics, LlmCallUsage } from "./extractRunMetrics.js";
import type { QueryRunResult, StressRunStatus } from "./stressTestAnalyze.js";

type QueryExecutionSource = "workflow_test" | "chat";

interface WorkflowExecutionInput {
  userId: string;
  workflowTestRunId: string;
  queryKey: string;
  attemptNumber: number;
  query: string;
  groupName: string;
  status: StressRunStatus;
  metrics: AttemptTokenMetrics;
  durationMs: number;
  requestId?: string;
  ranAt?: Date;
}

interface ChatExecutionInput {
  userId: string;
  messageId: string;
  query: string;
  status?: string;
  metrics: AttemptTokenMetrics;
  durationMs?: number;
  requestId?: string;
  ranAt?: Date;
}

function llmCallsJson(
  llmCalls: LlmCallUsage[],
): Prisma.InputJsonValue | undefined {
  if (llmCalls.length === 0) return undefined;
  return llmCalls as unknown as Prisma.InputJsonValue;
}

export async function insertWorkflowQueryExecution(
  input: WorkflowExecutionInput,
): Promise<void> {
  await prisma.queryExecution.create({
    data: {
      userId: input.userId,
      source: "workflow_test",
      workflowTestRunId: input.workflowTestRunId,
      queryKey: input.queryKey,
      attemptNumber: input.attemptNumber,
      query: input.query,
      groupName: input.groupName,
      status: input.status,
      promptTokens: input.metrics.promptTokens,
      completionTokens: input.metrics.completionTokens,
      totalTokens: input.metrics.totalTokens,
      llmCallCount: input.metrics.llmCallCount,
      llmCalls: llmCallsJson(input.metrics.llmCalls),
      durationMs: input.durationMs,
      requestId: input.requestId,
      ranAt: input.ranAt ?? new Date(),
    },
  });
}

export async function insertChatQueryExecution(
  input: ChatExecutionInput,
): Promise<void> {
  await prisma.queryExecution.create({
    data: {
      userId: input.userId,
      source: "chat",
      messageId: input.messageId,
      query: input.query,
      status: input.status ?? "completed",
      promptTokens: input.metrics.promptTokens,
      completionTokens: input.metrics.completionTokens,
      totalTokens: input.metrics.totalTokens,
      llmCallCount: input.metrics.llmCallCount,
      llmCalls: llmCallsJson(input.metrics.llmCalls),
      durationMs: input.durationMs ?? 0,
      requestId: input.requestId,
      ranAt: input.ranAt ?? new Date(),
    },
  });
}

export interface UsageTotals {
  executionCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCallCount: number;
}

export interface RecentExecutionRow {
  id: string;
  source: QueryExecutionSource;
  query: string;
  groupName: string | null;
  status: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCallCount: number;
  durationMs: number;
  attemptNumber: number;
  ranAt: string;
  workflowTestRunId: string | null;
  messageId: string | null;
}

function emptyTotals(): UsageTotals {
  return {
    executionCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    llmCallCount: 0,
  };
}

export async function aggregatePlatformUsage(
  userId: string,
  from?: Date,
  to?: Date,
): Promise<{
  totals: UsageTotals;
  bySource: Record<QueryExecutionSource, UsageTotals>;
  recentExecutions: RecentExecutionRow[];
}> {
  const ranAtFilter =
    from || to
      ? {
          ranAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

  const where = { userId, ...ranAtFilter };

  const [workflowAgg, chatAgg, recent] = await Promise.all([
    prisma.queryExecution.aggregate({
      where: { ...where, source: "workflow_test" },
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        llmCallCount: true,
      },
    }),
    prisma.queryExecution.aggregate({
      where: { ...where, source: "chat" },
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        llmCallCount: true,
      },
    }),
    prisma.queryExecution.findMany({
      where,
      orderBy: { ranAt: "desc" },
      take: 50,
      select: {
        id: true,
        source: true,
        query: true,
        groupName: true,
        status: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        llmCallCount: true,
        durationMs: true,
        attemptNumber: true,
        ranAt: true,
        workflowTestRunId: true,
        messageId: true,
      },
    }),
  ]);

  const toTotals = (
    agg: typeof workflowAgg,
  ): UsageTotals => ({
    executionCount: agg._count._all,
    promptTokens: agg._sum.promptTokens ?? 0,
    completionTokens: agg._sum.completionTokens ?? 0,
    totalTokens: agg._sum.totalTokens ?? 0,
    llmCallCount: agg._sum.llmCallCount ?? 0,
  });

  const bySource = {
    workflow_test: toTotals(workflowAgg),
    chat: toTotals(chatAgg),
  };

  const totals: UsageTotals = {
    executionCount:
      bySource.workflow_test.executionCount + bySource.chat.executionCount,
    promptTokens:
      bySource.workflow_test.promptTokens + bySource.chat.promptTokens,
    completionTokens:
      bySource.workflow_test.completionTokens + bySource.chat.completionTokens,
    totalTokens:
      bySource.workflow_test.totalTokens + bySource.chat.totalTokens,
    llmCallCount:
      bySource.workflow_test.llmCallCount + bySource.chat.llmCallCount,
  };

  return {
    totals,
    bySource,
    recentExecutions: recent.map((row) => ({
      ...row,
      ranAt: row.ranAt.toISOString(),
    })),
  };
}
