/**
 * Client mirror of server/workflowTestEta.ts, used to render an estimate before the
 * server has reported a real one (e.g. while still editing the Setup form).
 */

export const DEFAULT_AVG_QUERY_MS = 20_000;

export function estimateTotalMs(params: {
  queryCount: number;
  avgQueryMs?: number;
  delayMs: number;
}): number {
  const n = Math.max(0, Math.floor(params.queryCount));
  if (n === 0) return 0;
  const avgQueryMs = params.avgQueryMs ?? DEFAULT_AVG_QUERY_MS;
  const delayGaps = Math.max(0, n - 1) * Math.max(0, params.delayMs);
  return n * Math.max(0, avgQueryMs) + delayGaps;
}

export function estimateRemainingMs(params: {
  remainingQueries: number;
  avgQueryMs?: number;
  delayMs: number;
}): number {
  const remaining = Math.max(0, Math.floor(params.remainingQueries));
  if (remaining === 0) return 0;
  const avgQueryMs = params.avgQueryMs ?? DEFAULT_AVG_QUERY_MS;
  const delayGaps = Math.max(0, remaining - 1) * Math.max(0, params.delayMs);
  return remaining * Math.max(0, avgQueryMs) + delayGaps;
}

export function formatDurationEstimate(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `~${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return seconds > 0 ? `~${minutes}m ${seconds}s` : `~${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `~${hours}h ${remMin}m` : `~${hours}h`;
}
