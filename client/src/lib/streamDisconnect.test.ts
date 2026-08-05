import { describe, expect, test } from "bun:test";
import { isStreamDisconnectError } from "../api";

describe("isStreamDisconnectError", () => {
  test("detects Firefox input stream errors", () => {
    expect(isStreamDisconnectError(new Error("error in input stream"))).toBe(
      true,
    );
  });

  test("detects common network failures", () => {
    expect(isStreamDisconnectError(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    expect(isStreamDisconnectError(new Error("NetworkError when attempting"))).toBe(
      true,
    );
    expect(isStreamDisconnectError(new Error("Stream closed unexpectedly"))).toBe(
      true,
    );
  });

  test("does not treat AbortError as disconnect", () => {
    expect(
      isStreamDisconnectError(
        new DOMException("The operation was aborted.", "AbortError"),
      ),
    ).toBe(false);
  });

  test("does not treat normal app errors as disconnect", () => {
    expect(isStreamDisconnectError(new Error("No agent profile configured"))).toBe(
      false,
    );
  });
});
