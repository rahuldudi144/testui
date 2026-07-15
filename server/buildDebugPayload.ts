import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import type { InvokeResult } from "../../types/index.js";
import type { StateHistoryEntry } from "../../types/index.js";
import { finalizeRequestDebug } from "./debugCapture.js";
import {
  parseMetricsFromLogs,
  summarizeWorkflowStatus,
  buildWorkflowGraph,
  buildStateTimeline,
  type AgentRunContext,
} from "./parseDebugMetrics.js";

interface ActiveDbInfo {
  dbType: string;
  name: string;
  host: string;
  schemaTableCount?: number;
  metadataSource?: "stored" | "live";
  hasBusinessContext?: boolean;
  hasKnowledgeIndexed?: boolean;
}

export function createAgentRequestIds(conversationId: string): {
  requestId: string;
  correlationId: string;
} {
  return {
    requestId: randomUUID(),
    correlationId: conversationId,
  };
}

export function buildFullDebugPayload(
  requestId: string,
  correlationId: string,
  activeDb: ActiveDbInfo,
  runContext: AgentRunContext,
  extras: Record<string, unknown> = {},
): Prisma.InputJsonValue {
  const captured = finalizeRequestDebug(requestId);
  const logs = captured?.logs ?? [];
  const trace = captured?.trace as Record<string, unknown> | undefined;
  const metrics = parseMetricsFromLogs(logs);
  const stateHistory = parseStateHistory(extras.stateHistory);
  const workflow = summarizeWorkflowStatus(
    metrics,
    trace,
    runContext.output,
    stateHistory,
  );
  const graph = buildWorkflowGraph(
    metrics,
    trace,
    workflow,
    runContext,
    stateHistory,
  );
  const stateTimeline = buildStateTimeline(
    metrics,
    trace,
    workflow,
    runContext,
    stateHistory,
  );

  const { stateHistory: _rawHistory, ...restExtras } = extras;

  return {
    debugLevel: "full",
    requestId,
    correlationId,
    agent: runContext.agent,
    database: {
      type: activeDb.dbType,
      name: activeDb.name,
      host: activeDb.host,
      schemaTableCount: activeDb.schemaTableCount,
      metadataSource: activeDb.metadataSource,
      hasBusinessContext: activeDb.hasBusinessContext,
      hasKnowledgeIndexed: activeDb.hasKnowledgeIndexed,
    },
    input: runContext.input,
    output: runContext.output,
    workflow,
    graph,
    stateTimeline,
    stateHistory: stateHistory ?? [],
    metrics,
    trace: captured?.trace,
    logs,
    logCount: logs.length,
    ...restExtras,
  } as unknown as Prisma.InputJsonValue;
}

function parseStateHistory(value: unknown): StateHistoryEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries: StateHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.node !== "string") continue;
    const step = typeof record.step === "number" ? record.step : entries.length + 1;
    const changes =
      record.changes && typeof record.changes === "object" && !Array.isArray(record.changes)
        ? (record.changes as Record<string, unknown>)
        : {};
    entries.push({ step, node: record.node, changes });
  }
  return entries.length > 0 ? entries : undefined;
}

export function invokeResultDebugFields(
  result: InvokeResult,
): AgentRunContext["output"] {
  return {
    markdownResponse: result.markdownResponse,
    generatedSql: result.generatedSql ?? null,
    validationPassed: result.validationPassed,
    validationErrors: result.validationErrors,
    executionResult: result.executionResult,
  };
}

export function buildAgentRunContext(
  query: string,
  dryRun: boolean,
  priorMessages: AgentRunContext["input"]["messages"],
  agentConfig: AgentRunContext["agent"],
  output?: AgentRunContext["output"],
): AgentRunContext {
  return {
    agent: agentConfig,
    input: {
      query,
      dryRun,
      priorMessageCount: priorMessages.length,
      messages: priorMessages,
    },
    output,
  };
}
