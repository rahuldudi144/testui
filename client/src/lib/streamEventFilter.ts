import type { AgentEvent } from "../types/agentEvents";

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
