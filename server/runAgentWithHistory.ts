/**
 * Testui-only agent runner that captures stateHistory from the graph final state.
 * Mirrors DatabaseAgent.runGraph / stream without modifying the agent module.
 */
import type {
  DatabaseAgentConfig,
  DatabaseType,
  InvokeInput,
  InvokeResult,
} from "../../types/index.js";
import type {
  AgentInput,
  AgentState,
  StateHistoryEntry,
} from "../../schemas/state.js";
import type { AgentRuntime } from "../../types/runtime.js";
import { RUNTIME_KEY } from "../../types/runtime.js";
import type { DatabaseAdapter } from "../../database/adapter.js";
import { createAdapter } from "../../database/createAdapter.js";
import { withLoggingAdapter } from "../../database/withLoggingAdapter.js";
import { createChatModel } from "../../llm/createChatModel.js";
import {
  createInvocationChatModel,
  invocationUsesCustomLlm,
  resolveInvocationLlmConfig,
} from "../../llm/resolveInvocationLlm.js";
import { buildGraph } from "../../graph/buildGraph.js";
import type { CompiledAgentGraph } from "../../graph/buildGraph.js";
import {
  createObservabilityContext,
  resolveRequestId,
  toSpanError,
  wrapAdapterWithObservability,
  wrapLlmWithObservability,
} from "../../observability/index.js";
import type { ObservabilityContext } from "../../observability/types.js";
import { loggerFromStructured } from "../../utils/logger.js";
import type { Logger } from "../../utils/logger.js";
import { AgentError, errorMessage } from "../../utils/errors.js";
import { isAbortError, throwIfAborted } from "../../utils/abort.js";
import { resolveInvocationSystemPrompt } from "../../prompts/composeSystemMessage.js";
import { extractText } from "../../nodes/shared.js";
import { buildConfig, createAgent } from "./agent.js";
import type { AgentConfigOverrides } from "./agent.js";
import type { AgentEvent } from "../../types/events.js";
import {
  getRequestDebugSnapshot,
  subscribeRequestLogs,
} from "./debugCapture.js";
import {
  createLogStreamContext,
  logEntryToAgentEvents,
} from "./logStreamEvents.js";

const graph: CompiledAgentGraph = buildGraph();

type RunnerOptions = AgentConfigOverrides;

class AgentRunner {
  private readonly config: DatabaseAgentConfig;
  private readonly readOnly: boolean;
  private readonly maxRetries: number;
  private readonly maxAnswerRetries: number;
  private readonly llm: ReturnType<typeof createChatModel>;
  private readonly dbUri: string;

  constructor(config: DatabaseAgentConfig, dbUri: string) {
    this.config = config;
    this.readOnly = config.readOnly ?? true;
    this.maxRetries = config.maxValidationRetries ?? 3;
    this.maxAnswerRetries = config.maxAnswerRetries ?? 2;
    this.llm = createChatModel(config);
    this.dbUri = dbUri;
  }

  async invoke(
    input: InvokeInput,
  ): Promise<{ result: InvokeResult; stateHistory: StateHistoryEntry[] }> {
    validateInput(input);
    const { finalState, observability } = await this.runGraph(input);
    observability.logger.info({ event: "invoke_completed" });
    return {
      result: toResult(finalState),
      stateHistory: finalState.stateHistory ?? [],
    };
  }

  async *stream(
    input: InvokeInput,
  ): AsyncGenerator<string, StateHistoryEntry[]> {
    validateInput(input);
    throwIfAborted(input.abortSignal);
    const observability = this.createObservability(input);
    const logger = loggerFromStructured(observability.logger);
    const tags = metricTags(observability);

    observability.metrics.increment("agent.requests.total", tags);
    observability.logger.info({ event: "stream_start" });

    let success = false;
    let caughtError: unknown;
    let finalState: AgentState | undefined;
    const adapter = await this.openAdapter(logger, observability);

    try {
      const stream = await graph.stream(this.toInputState(input), {
        configurable: {
          [RUNTIME_KEY]: this.buildRuntime(
            input,
            adapter,
            logger,
            observability,
          ),
        },
        streamMode: ["messages", "values"],
        signal: input.abortSignal,
      });

      let streamedAnything = false;
      let finalMarkdown = "";

      for await (const chunk of stream) {
        throwIfAborted(input.abortSignal);
        const [mode, payload] = chunk as [string, unknown];

        if (mode === "messages") {
          const [message, metadata] = payload as [
            Parameters<typeof extractText>[0],
            { langgraph_node?: string },
          ];
          if (isMarkdownNode(metadata?.langgraph_node)) {
            const text = extractText(message);
            if (text) {
              streamedAnything = true;
              yield text;
            }
          }
        } else if (mode === "values") {
          finalState = payload as AgentState;
          finalMarkdown = finalState.markdownResponse || finalMarkdown;
        }
      }

      if (!streamedAnything && finalMarkdown) {
        yield finalMarkdown;
      }

      success = true;
      observability.metrics.increment("agent.requests.success", tags);
      observability.logger.info({ event: "stream_completed" });
    } catch (error) {
      caughtError = error;
      if (isAbortError(error)) {
        observability.logger.info({ event: "request_aborted" });
        throw error;
      }
      observability.metrics.increment("agent.requests.failed", tags);
      observability.logger.error({
        event: "stream_failed",
        error: toSpanError(error),
      });
      throw new AgentError(
        "STREAM_FAILED",
        `The agent failed while streaming the answer: ${errorMessage(error)}`,
        error,
      );
    } finally {
      await closeAdapter(adapter, logger);
      completeTrace(observability, success, caughtError);
    }

    return finalState?.stateHistory ?? [];
  }

  private createObservability(input: InvokeInput): ObservabilityContext {
    const requestId = resolveRequestId(input.requestId);
    const llm = resolveInvocationLlmConfig(this.config, input);
    return createObservabilityContext({
      requestId,
      correlationId: input.correlationId,
      provider: llm.llmProvider,
      model: llm.modelName,
      dbType: this.config.dbType,
    });
  }

  private async runGraph(
    input: InvokeInput,
  ): Promise<{ finalState: AgentState; observability: ObservabilityContext }> {
    const observability = this.createObservability(input);
    const logger = loggerFromStructured(observability.logger);
    const tags = metricTags(observability);

    observability.metrics.increment("agent.requests.total", tags);
    observability.logger.info({ event: "invoke_start" });
    throwIfAborted(input.abortSignal);

    let success = false;
    let caughtError: unknown;
    let finalState: AgentState | undefined;
    const adapter = await this.openAdapter(logger, observability);

    try {
      finalState = (await graph.invoke(this.toInputState(input), {
        configurable: {
          [RUNTIME_KEY]: this.buildRuntime(
            input,
            adapter,
            logger,
            observability,
          ),
        },
        signal: input.abortSignal,
      })) as AgentState;

      success = true;
      observability.metrics.increment("agent.requests.success", tags);
      return { finalState, observability };
    } catch (error) {
      caughtError = error;
      if (isAbortError(error)) {
        observability.logger.info({ event: "request_aborted" });
        throw error;
      }
      observability.metrics.increment("agent.requests.failed", tags);
      observability.logger.error({
        event: "invoke_failed",
        error: toSpanError(error),
      });
      throw new AgentError(
        "EXECUTION_FAILED",
        `The agent failed to answer the request: ${errorMessage(error)}`,
        error,
      );
    } finally {
      await closeAdapter(adapter, logger);
      completeTrace(observability, success, caughtError);
    }
  }

  private async openAdapter(
    logger: Logger,
    observability: ObservabilityContext,
  ): Promise<DatabaseAdapter> {
    const base = createAdapter(this.config.dbType, this.dbUri);
    const observing = wrapAdapterWithObservability(base, observability);
    const adapter = withLoggingAdapter(observing, logger);

    try {
      await adapter.connect();
      return adapter;
    } catch (error) {
      logger.error(`database connection failed: ${errorMessage(error)}`);
      throw new AgentError(
        "DB_CONNECTION_FAILED",
        `Could not connect to the database: ${errorMessage(error)}`,
        error,
      );
    }
  }

  private buildRuntime(
    input: InvokeInput,
    adapter: DatabaseAdapter,
    logger: AgentRuntime["logger"],
    observability: ObservabilityContext,
  ): AgentRuntime {
    const llm =
      invocationUsesCustomLlm(this.config, input)
        ? createInvocationChatModel(this.config, input)
        : this.llm;

    return {
      llm: wrapLlmWithObservability(llm, observability, {
        streamEvents: input.streamEvents ?? false,
      }),
      adapter,
      dbType: this.config.dbType,
      readOnly: this.readOnly,
      maxRetries: this.maxRetries,
      maxAnswerRetries: this.maxAnswerRetries,
      logger,
      streamEvents: input.streamEvents ?? false,
      debug: input.debug ?? false,
      observability,
    };
  }

  private toInputState(input: InvokeInput): AgentInput {
    return {
      query: input.query,
      messages: input.messages ?? [],
      systemPrompt: resolveInvocationSystemPrompt(
        this.config.systemPrompt,
        input.systemPrompt,
      ),
      businessContext: input.businessContext,
      systemPromptMode: input.systemPromptMode ?? "append",
      dbMetadata: input.dbMetadata,
      dryRun: input.dryRun ?? false,
    };
  }
}

function createRunner(
  dbType: DatabaseType,
  dbUri: string,
  options?: RunnerOptions,
): AgentRunner {
  return new AgentRunner(buildConfig(dbType, options), dbUri);
}

export async function invokeWithHistory(
  dbType: DatabaseType,
  dbUri: string,
  input: InvokeInput,
  runnerOptions?: RunnerOptions,
): Promise<{ result: InvokeResult; stateHistory: StateHistoryEntry[] }> {
  return createRunner(dbType, dbUri, runnerOptions).invoke(input);
}

export function streamWithHistory(
  dbType: DatabaseType,
  dbUri: string,
  input: InvokeInput,
  runnerOptions?: RunnerOptions,
): AsyncGenerator<string, StateHistoryEntry[]> {
  return createRunner(dbType, dbUri, runnerOptions).stream(input);
}

/** Stream typed AgentEvents via DatabaseAgent (streamEvents + debug enabled). */
export async function* streamAgentEvents(
  dbType: DatabaseType,
  dbUri: string,
  input: Omit<InvokeInput, "streamEvents" | "debug">,
  runnerOptions?: RunnerOptions,
): AsyncGenerator<AgentEvent> {
  const requestId = input.requestId;
  if (!requestId) {
    throw new AgentError(
      "INVALID_INPUT",
      "requestId is required for streamAgentEvents.",
    );
  }

  const agent = createAgent(dbType, dbUri, runnerOptions);
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
        ...input,
        streamEvents: true,
        debug: true,
        abortSignal: input.abortSignal,
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

function toResult(state: AgentState): InvokeResult {
  const usedSql = state.isDomainSpecific && state.requiresSql;

  return {
    markdownResponse: state.markdownResponse,
    generatedSql:
      usedSql && state.generatedSql ? state.generatedSql : undefined,
    validationPassed: usedSql ? state.validationPassed : undefined,
    validationErrors:
      usedSql && state.validationErrors.length > 0
        ? state.validationErrors
        : undefined,
    executionResult: state.executionResult,
  };
}

function metricTags(
  observability: ObservabilityContext,
): Record<string, string> {
  return observability.correlationId
    ? {
        requestId: observability.requestId,
        correlationId: observability.correlationId,
      }
    : { requestId: observability.requestId };
}

function completeTrace(
  observability: ObservabilityContext,
  success: boolean,
  error?: unknown,
): void {
  observability.tracer.complete(
    observability.requestId,
    success,
    error ? toSpanError(error) : undefined,
  );
}

function isMarkdownNode(node: string | undefined): boolean {
  return node === "answer" || node === "formatResponse";
}

function validateInput(input: InvokeInput): void {
  if (!input || typeof input.query !== "string" || input.query.trim() === "") {
    throw new AgentError("INVALID_INPUT", "A non-empty query is required.");
  }
}

async function closeAdapter(
  adapter: DatabaseAdapter,
  logger: Logger,
): Promise<void> {
  try {
    await adapter.close();
  } catch (error) {
    logger.warn(`DB: failed to close connection — ${errorMessage(error)}`);
  }
}
