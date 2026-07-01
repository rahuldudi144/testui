import type { ParsedRunMetrics } from "./parseDebugMetrics.js";

export interface LlmCallUsage {
  node?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

export interface AttemptTokenMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCallCount: number;
  llmCalls: LlmCallUsage[];
}

export function extractMetricsFromDebug(
  debug: unknown,
): AttemptTokenMetrics {
  const record =
    debug && typeof debug === "object" && !Array.isArray(debug)
      ? (debug as Record<string, unknown>)
      : undefined;
  const metrics = record?.metrics as ParsedRunMetrics | undefined;

  if (!metrics) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      llmCallCount: 0,
      llmCalls: [],
    };
  }

  const llmCalls: LlmCallUsage[] = (metrics.llmCalls ?? []).map((call) => ({
    node: call.node,
    promptTokens: call.promptTokens,
    completionTokens: call.completionTokens,
    totalTokens: call.totalTokens,
    latencyMs: call.latencyMs,
  }));

  return {
    promptTokens: metrics.totals?.totalPromptTokens ?? 0,
    completionTokens: metrics.totals?.totalCompletionTokens ?? 0,
    totalTokens:
      (metrics.totals?.totalPromptTokens ?? 0) +
      (metrics.totals?.totalCompletionTokens ?? 0),
    llmCallCount: metrics.totals?.llmCallCount ?? llmCalls.length,
    llmCalls,
  };
}

export function extractMetricsFromMessageDebug(
  debugData: unknown,
): AttemptTokenMetrics {
  return extractMetricsFromDebug(debugData);
}
