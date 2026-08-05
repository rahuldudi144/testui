/**
 * ETA helpers for workflow test runs.
 */

export const DEFAULT_AVG_QUERY_MS = 20_000;

export function median(values: number[]): number | null {
  const sorted = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return Math.round(sorted[mid]!);
}

export function estimateTotalMs(params: {
  queryCount: number;
  avgQueryMs: number;
  delayMs: number;
}): number {
  const n = Math.max(0, Math.floor(params.queryCount));
  if (n === 0) return 0;
  const delayGaps = Math.max(0, n - 1) * Math.max(0, params.delayMs);
  return n * Math.max(0, params.avgQueryMs) + delayGaps;
}

export function estimateRemainingMs(params: {
  remainingQueries: number;
  rollingAvgMs: number;
  delayMs: number;
}): number {
  const remaining = Math.max(0, Math.floor(params.remainingQueries));
  if (remaining === 0) return 0;
  const delayGaps = Math.max(0, remaining - 1) * Math.max(0, params.delayMs);
  return remaining * Math.max(0, params.rollingAvgMs) + delayGaps;
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

/** Pick avg query duration: last-run median (≥3), else suite median, else default. */
export function resolveAvgQueryMs(params: {
  lastRunDurations?: number[];
  suiteDurations?: number[];
  defaultMs?: number;
}): number {
  const last = params.lastRunDurations ?? [];
  if (last.length >= 3) {
    const m = median(last);
    if (m != null) return m;
  }
  const suite = params.suiteDurations ?? [];
  if (suite.length >= 3) {
    const m = median(suite);
    if (m != null) return m;
  }
  return params.defaultMs ?? DEFAULT_AVG_QUERY_MS;
}
