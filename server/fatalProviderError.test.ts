import { describe, expect, test } from "bun:test";
import { AgentError } from "../../utils/errors.js";
import {
  formatFatalProviderStopMessage,
  isFatalProviderError,
} from "./fatalProviderError.js";

describe("isFatalProviderError", () => {
  test("stops on auth, billing, and rate-limit failures", () => {
    expect(isFatalProviderError({ status: 401, message: "nope" })).toBe(true);
    expect(isFatalProviderError({ status: 402, message: "nope" })).toBe(true);
    expect(isFatalProviderError(new Error("rate limit exceeded"))).toBe(true);
    expect(
      isFatalProviderError(
        new AgentError("MODEL_LIMIT_EXCEEDED", "model limit"),
      ),
    ).toBe(true);
  });

  test("keeps going for ordinary query failures", () => {
    expect(isFatalProviderError(new Error("syntax error at position 12"))).toBe(
      false,
    );
  });
});

describe("formatFatalProviderStopMessage", () => {
  test("describes the provider failure from status or message text", () => {
    expect(formatFatalProviderStopMessage({ status: 401 })).toBe(
      "Run stopped: authentication failed (401)",
    );
    expect(formatFatalProviderStopMessage(new Error("billing hard limit"))).toBe(
      "Run stopped: insufficient tokens / billing issue (402)",
    );
    expect(formatFatalProviderStopMessage(new Error("too many requests"))).toBe(
      "Run stopped: rate limit exceeded (429)",
    );
  });
});
