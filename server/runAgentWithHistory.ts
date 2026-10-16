/**
 * Test UI query entry. Uses the same DatabaseAgent call as the main app.
 * Suite timing and debug capture stay outside this call.
 */
import type { InvokeInput, InvokeResult, StateHistoryEntry } from "../../types/index.js";
import type { AgentEvent } from "../../types/events.js";
import { AgentError } from "../../utils/errors.js";
import { throwIfAborted } from "../../utils/abort.js";
import {
  getRequestDebugSnapshot,
  subscribeRequestLogs,
} from "./debugCapture.js";
import {
  createLogStreamContext,
  logEntryToAgentEvents,
} from "./logStreamEvents.js";
import { loadEnv } from "./env.js";
import {
  capAgentMessages,
  createQueryAgent,
  ensureQuerySchema,
  getSchemaContext,
} from "./queryTarget.js";

function queryInput(input: InvokeInput): InvokeInput {
  const summary = loadEnv().DB_AGENT_BUSINESS_SUMMARY?.trim();
  const schemaContext = getSchemaContext();
  return {
    query: input.query,
    messages: capAgentMessages(input.messages),
    dryRun: input.dryRun,
    requestId: input.requestId,
    correlationId: input.correlationId,
    abortSignal: input.abortSignal,
    liveSchema: schemaContext?.liveSchema,
    schemaContext,
    businessSummary: input.businessSummary ?? (summary || undefined),
    priorSql: input.priorSql,
    streamEvents: input.streamEvents,
    debug: input.debug,
  };
}

export async function invokeWithHistory(
  _dbType: string,
  _dbUri: string,
  input: InvokeInput,
): Promise<{ result: InvokeResult; stateHistory: StateHistoryEntry[] }> {
  await ensureQuerySchema();
  const agent = createQueryAgent();
  const result = await agent.invoke({
    ...queryInput(input),
    debug: true,
  });
  return {
    result,
    stateHistory: result.stateHistory ?? [],
  };
}

/** Stream typed AgentEvents via DatabaseAgent (streamEvents + debug enabled). */
export async function* streamAgentEvents(
  _dbType: string,
  _dbUri: string,
  input: Omit<InvokeInput, "streamEvents" | "debug">,
): AsyncGenerator<AgentEvent> {
  const requestId = input.requestId;
  if (!requestId) {
    throw new AgentError(
      "INVALID_INPUT",
      "requestId is required for streamAgentEvents.",
    );
  }

  await ensureQuerySchema();
  const agent = createQueryAgent();
  const logContext = createLogStreamContext();
  const pending: AgentEvent[] = [];
  let logCursor = 0;
  let resolveWait: (() => void) | null = null;
  let agentDone = false;
  let agentError: unknown;

  const wake = () => {
    resolveWait?.();
    resolveWait = null;
  };

  const drainLogs = () => {
    const snapshot = getRequestDebugSnapshot(requestId);
    if (!snapshot) return;

    while (logCursor < snapshot.logs.length) {
      const log = snapshot.logs[logCursor];
      logCursor += 1;
      for (const event of logEntryToAgentEvents(log, logContext)) {
        pending.push(event);
      }
    }
  };

  const unsubscribe = subscribeRequestLogs(requestId, () => {
    drainLogs();
    wake();
  });

  const agentTask = (async () => {
    try {
      for await (const chunk of agent.stream({
        ...queryInput(input),
        streamEvents: true,
        debug: true,
      })) {
        drainLogs();
        pending.push(
          typeof chunk === "string" ? { type: "token", content: chunk } : chunk,
        );
        wake();
      }
    } catch (error) {
      agentError = error;
      throw error;
    } finally {
      drainLogs();
      agentDone = true;
      wake();
    }
  })();

  try {
    while (!agentDone || pending.length > 0) {
      throwIfAborted(input.abortSignal);
      drainLogs();
      if (pending.length > 0) {
        yield pending.shift()!;
        continue;
      }
      if (agentDone) break;
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
  } finally {
    unsubscribe();
    await agentTask.catch(() => undefined);
    if (agentError) {
      throw agentError;
    }
  }
}
