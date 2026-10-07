import {
  AgentError,
  errorMessage,
  isModelLimitError,
} from "../../utils/errors.js";

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const record = error as Record<string, unknown>;
  const direct = record.status ?? record.statusCode;
  if (typeof direct === "number") return direct;

  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }

  return undefined;
}

function providerStatus(error: unknown): number | undefined {
  if (error instanceof AgentError) {
    return readStatus(error) ?? readStatus(error.cause);
  }

  return (
    readStatus(error) ??
    (error && typeof error === "object"
      ? readStatus((error as { cause?: unknown }).cause)
      : undefined)
  );
}

/**
 * True for provider failures that should stop a workflow run:
 * auth (401), billing (402), and rate limits (429 / quota).
 */
export function isFatalProviderError(error: unknown): boolean {
  if (isModelLimitError(error)) return true;

  if (error instanceof AgentError && error.code === "MODEL_LIMIT_EXCEEDED") {
    return true;
  }

  const status = providerStatus(error);
  if (status === 401 || status === 402 || status === 429) return true;

  const msg = errorMessage(error).toLowerCase();
  return (
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("authentication failed") ||
    msg.includes("payment required") ||
    msg.includes("insufficient") ||
    msg.includes("billing") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  );
}

/** Human-readable stop message for fatal provider errors. */
export function formatFatalProviderStopMessage(error: unknown): string {
  const status = providerStatus(error);

  if (status === 401) return "Run stopped: authentication failed (401)";
  if (status === 402) {
    return "Run stopped: insufficient tokens / billing issue (402)";
  }
  if (status === 429 || isModelLimitError(error)) {
    return "Run stopped: rate limit exceeded (429)";
  }

  const msg = errorMessage(error).toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("authentication")
  ) {
    return "Run stopped: authentication failed (401)";
  }
  if (
    msg.includes("payment") ||
    msg.includes("billing") ||
    msg.includes("insufficient")
  ) {
    return "Run stopped: insufficient tokens / billing issue (402)";
  }
  return "Run stopped: provider limit or auth error";
}
