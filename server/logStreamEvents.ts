import type { AgentEvent, GraphNodeName } from "../../types/events.js";
import { isGraphNodeName } from "../../types/events.js";

interface LogStreamContext {
  currentNode: GraphNodeName | null;
}

const GRAPH_NODES: GraphNodeName[] = [
  "planner",
  "schemaResolver",
  "buildQuery",
  "validateQuery",
  "runQuery",
  "formatResponse",
  "answer",
];

function asNode(value: unknown): GraphNodeName | null {
  return typeof value === "string" && isGraphNodeName(value) ? value : null;
}

function extractSqlFromBuildQueryLog(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const marker = "buildQuery: SQL generated — ";
  const index = message.indexOf(marker);
  if (index === -1) return null;
  const sql = message.slice(index + marker.length).trim();
  return sql.length > 0 ? sql : null;
}

export function createLogStreamContext(): LogStreamContext {
  return { currentNode: null };
}

export function logEntryToAgentEvents(
  log: Record<string, unknown>,
  ctx: LogStreamContext,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const node = asNode(log.node);
  const eventName = typeof log.event === "string" ? log.event : null;

  if (node && eventName === "node_start") {
    ctx.currentNode = node;
    events.push({ type: "node_start", node });
  }

  if (node && eventName === "node_end" && typeof log.durationMs === "number") {
    events.push({
      type: "node_complete",
      node,
      durationMs: log.durationMs,
    });
    if (ctx.currentNode === node) {
      ctx.currentNode = null;
    }
  }

  const sql = extractSqlFromBuildQueryLog(log.message);
  if (sql) {
    events.push({ type: "sql_generated", sql });
  }

  if (eventName === "validation_attempt" && log.validationPassed === false) {
    const errorCount = typeof log.errorCount === "number" ? log.errorCount : 1;
    events.push({
      type: "validation_failed",
      errors: [
        `Validation failed (${errorCount} error${errorCount === 1 ? "" : "s"})`,
      ],
    });
  }

  if (
    eventName === "db_run_query" &&
    ctx.currentNode === "runQuery" &&
    typeof log.rowCount === "number"
  ) {
    events.push({ type: "query_executed", rowCount: log.rowCount });
  }

  if (
    eventName === "verification_attempt" &&
    typeof log.answerSatisfied === "boolean"
  ) {
    events.push({
      type: "answer_verification",
      answered: log.answerSatisfied,
    });
  }

  return events;
}

export function orderedGraphNodes(): GraphNodeName[] {
  return GRAPH_NODES;
}
