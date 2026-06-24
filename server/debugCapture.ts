import type { CompletedTrace, TraceExporter } from "../../observability/index.js";
import { configureObservability } from "../../index.js";

export interface RequestDebugSnapshot {
  requestId: string;
  correlationId?: string;
  logs: Record<string, unknown>[];
  trace?: CompletedTrace;
}

const snapshots = new Map<string, RequestDebugSnapshot>();
const logListeners = new Map<string, Set<() => void>>();

function notifyLogListeners(requestId: string): void {
  const listeners = logListeners.get(requestId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

let installed = false;

class CapturingTraceExporter implements TraceExporter {
  export(trace: CompletedTrace): void {
    const existing = snapshots.get(trace.requestId);
    if (existing) {
      existing.trace = trace;
      return;
    }
    snapshots.set(trace.requestId, {
      requestId: trace.requestId,
      correlationId: trace.correlationId,
      logs: [],
      trace,
    });
  }
}

function tryParseStructuredLog(arg: unknown): Record<string, unknown> | null {
  if (typeof arg !== "string") return null;
  try {
    const parsed = JSON.parse(arg) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.service === "db-agent") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function appendLog(requestId: string, entry: Record<string, unknown>): void {
  const snapshot = snapshots.get(requestId) ?? {
    requestId,
    correlationId:
      typeof entry.correlationId === "string" ? entry.correlationId : undefined,
    logs: [],
  };
  snapshot.logs.push(entry);
  snapshots.set(requestId, snapshot);
  notifyLogListeners(requestId);
}

function wrapConsole(
  level: "info" | "warn" | "error",
  original: typeof console.info,
): typeof console.info {
  return (...args: unknown[]) => {
    for (const arg of args) {
      const parsed = tryParseStructuredLog(arg);
      if (parsed && typeof parsed.requestId === "string") {
        appendLog(parsed.requestId, parsed);
      }
    }
    original.apply(console, args as Parameters<typeof console.info>);
  };
}

export function initDebugCapture(): void {
  if (installed) return;
  installed = true;

  configureObservability({
    traceExporters: [new CapturingTraceExporter()],
  });

  console.info = wrapConsole("info", console.info.bind(console));
  console.warn = wrapConsole("warn", console.warn.bind(console));
  console.error = wrapConsole("error", console.error.bind(console));
}

export function beginRequestDebug(
  requestId: string,
  correlationId?: string,
): void {
  snapshots.set(requestId, {
    requestId,
    correlationId,
    logs: [],
  });
  logListeners.delete(requestId);
}

export function getRequestDebugSnapshot(
  requestId: string,
): RequestDebugSnapshot | undefined {
  const snapshot = snapshots.get(requestId);
  if (!snapshot) return undefined;
  return {
    requestId: snapshot.requestId,
    correlationId: snapshot.correlationId,
    logs: [...snapshot.logs],
    trace: snapshot.trace,
  };
}

export function subscribeRequestLogs(
  requestId: string,
  listener: () => void,
): () => void {
  let listeners = logListeners.get(requestId);
  if (!listeners) {
    listeners = new Set();
    logListeners.set(requestId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      logListeners.delete(requestId);
    }
  };
}

export function finalizeRequestDebug(
  requestId: string,
): RequestDebugSnapshot | undefined {
  const snapshot = snapshots.get(requestId);
  if (!snapshot) return undefined;

  // Keep last 50 request snapshots to avoid unbounded memory.
  if (snapshots.size > 50) {
    const oldest = snapshots.keys().next().value;
    if (oldest) snapshots.delete(oldest);
  }

  return {
    requestId: snapshot.requestId,
    correlationId: snapshot.correlationId,
    logs: [...snapshot.logs],
    trace: snapshot.trace,
  };
}
