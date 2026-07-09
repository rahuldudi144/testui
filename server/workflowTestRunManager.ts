export type RunStreamEvent = {
  event: string;
  data: string;
};

type RunSubscriber = (event: RunStreamEvent) => void;

interface ActiveRunEntry {
  runId: string;
  userId: string;
  cancelController: AbortController;
  subscribers: Set<RunSubscriber>;
  endResolve?: () => void;
  endPromise?: Promise<void>;
}

const activeRuns = new Map<string, ActiveRunEntry>();

function ensureEndPromise(entry: ActiveRunEntry): Promise<void> {
  if (!entry.endPromise) {
    entry.endPromise = new Promise<void>((resolve) => {
      entry.endResolve = resolve;
    });
  }
  return entry.endPromise;
}

export function registerActiveRun(runId: string, userId: string): AbortController {
  const existing = activeRuns.get(runId);
  if (existing) {
    return existing.cancelController;
  }

  const cancelController = new AbortController();
  const entry: ActiveRunEntry = {
    runId,
    userId,
    cancelController,
    subscribers: new Set(),
  };
  ensureEndPromise(entry);
  activeRuns.set(runId, entry);
  return cancelController;
}

export function unregisterActiveRun(runId: string): void {
  const entry = activeRuns.get(runId);
  if (!entry) return;
  entry.endResolve?.();
  activeRuns.delete(runId);
}

export function getRunAbort(runId: string): {
  isAborted: () => boolean;
  signal: AbortSignal;
} | null {
  const entry = activeRuns.get(runId);
  if (!entry) return null;
  return {
    isAborted: () => entry.cancelController.signal.aborted,
    signal: entry.cancelController.signal,
  };
}

export function cancelActiveRun(runId: string, userId: string): boolean {
  const entry = activeRuns.get(runId);
  if (!entry || entry.userId !== userId) return false;
  entry.cancelController.abort();
  return true;
}

export function findActiveRunIdForUser(userId: string): string | null {
  for (const entry of activeRuns.values()) {
    if (entry.userId === userId) {
      return entry.runId;
    }
  }
  return null;
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function subscribeRunEvents(
  runId: string,
  listener: RunSubscriber,
): () => void {
  const entry = activeRuns.get(runId);
  if (!entry) return () => undefined;
  entry.subscribers.add(listener);
  return () => {
    entry.subscribers.delete(listener);
  };
}

export function broadcastRunEvent(runId: string, event: RunStreamEvent): void {
  const entry = activeRuns.get(runId);
  if (!entry) return;
  for (const listener of entry.subscribers) {
    try {
      listener(event);
    } catch {
      // ignore subscriber errors
    }
  }
}

export async function safeWriteSSE(
  stream: { writeSSE: (message: RunStreamEvent) => Promise<void> },
  runId: string,
  message: RunStreamEvent,
): Promise<void> {
  broadcastRunEvent(runId, message);
  try {
    await stream.writeSSE(message);
  } catch {
    // client disconnected — run continues
  }
}

export function wrapStreamForRun(
  runId: string,
  stream: {
    writeSSE: (message: RunStreamEvent) => Promise<void>;
    onAbort: (listener: () => void) => void;
  },
): {
  writeSSE: (message: RunStreamEvent) => Promise<void>;
  onAbort: (listener: () => void) => void;
} {
  return {
    writeSSE: (message) => safeWriteSSE(stream, runId, message),
    onAbort: stream.onAbort,
  };
}

export function waitForRunEnd(runId: string): Promise<void> {
  const entry = activeRuns.get(runId);
  if (!entry) return Promise.resolve();
  return ensureEndPromise(entry);
}

export function createActivityEmitterForRun(
  runId: string,
  stream: { writeSSE: (message: RunStreamEvent) => Promise<void> },
): (message: string) => void {
  let chain = Promise.resolve();
  return (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    chain = chain.then(() =>
      safeWriteSSE(stream, runId, {
        event: "status",
        data: JSON.stringify({ message: trimmed }),
      }),
    );
    void chain;
  };
}
