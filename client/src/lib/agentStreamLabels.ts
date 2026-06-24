import type { GraphNodeName } from "../types/agentEvents";

const NODE_LABELS: Record<GraphNodeName, string> = {
  planner: "Planning",
  schemaResolver: "Loading schema",
  buildQuery: "Generating SQL",
  validateQuery: "Validating SQL",
  runQuery: "Executing query",
  formatResponse: "Formatting response",
  answer: "Answering",
};

export function nodeStreamLabel(node: GraphNodeName): string {
  return NODE_LABELS[node] ?? node;
}
