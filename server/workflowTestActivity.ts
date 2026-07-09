import {
  getRequestDebugSnapshot,
  subscribeRequestLogs,
} from "./debugCapture.js";

export function formatWorkflowActivityLog(
  entry: Record<string, unknown>,
): string | null {
  if (typeof entry.message === "string" && entry.message.trim()) {
    return entry.message.trim();
  }

  const event = typeof entry.event === "string" ? entry.event : null;
  const node = typeof entry.node === "string" ? entry.node : null;

  if (event === "node_start" && node) {
    return `${node}: started`;
  }
  if (event === "node_end" && node) {
    const duration =
      typeof entry.durationMs === "number" ? ` (${entry.durationMs}ms)` : "";
    return `${node}: done${duration}`;
  }
  if (event === "llm_structured_call" && node) {
    const latency =
      typeof entry.latencyMs === "number" ? ` · ${entry.latencyMs}ms` : "";
    const tokens =
      typeof entry.totalTokens === "number"
        ? ` · ${entry.totalTokens} tokens`
        : "";
    return `${node}: LLM call${latency}${tokens}`;
  }
  if (event === "db_connect") {
    return "Database: connecting…";
  }
  if (event === "db_fetch_schema") {
    const count =
      typeof entry.tableCount === "number" ? ` (${entry.tableCount} tables)` : "";
    return `Database: schema loaded${count}`;
  }

  return null;
}

export function subscribeWorkflowActivity(
  requestId: string,
  onLine: (line: string) => void,
): () => void {
  let cursor = 0;

  const drain = () => {
    const snapshot = getRequestDebugSnapshot(requestId);
    if (!snapshot) return;
    while (cursor < snapshot.logs.length) {
      const line = formatWorkflowActivityLog(snapshot.logs[cursor]!);
      cursor += 1;
      if (line) onLine(line);
    }
  };

  drain();
  return subscribeRequestLogs(requestId, drain);
}
