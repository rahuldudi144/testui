import type { AgentEvent } from "../../types/events.js";

/**
 * Events forwarded to the chat SSE stream.
 * When streamDebug is false, hide sql_generated/debug payloads only —
 * node lifecycle events still drive the chat progress UI.
 */
export function isPublicStreamEvent(
  event: AgentEvent,
  streamDebug: boolean,
): boolean {
  if (streamDebug) return true;
  switch (event.type) {
    case "sql_generated":
    case "debug":
      return false;
    default:
      return true;
  }
}
