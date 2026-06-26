import type { GraphNodeName } from "../types/agentEvents";

const NODE_LABELS: Record<GraphNodeName, string> = {
  planner: "Planning",
  schemaResolver: "Loading schema",
  graphBuilder: "Building relationship graph",
  entityExtractor: "Identifying entities",
  pathFinder: "Finding join paths",
  operationPlanner: "Planning operations",
  buildQuery: "Generating SQL",
  validateQuery: "Validating SQL",
  runQuery: "Executing query",
  repairQuery: "Repairing SQL",
  formatResponse: "Formatting response",
  answer: "Answering",
};

export function nodeStreamLabel(node: GraphNodeName): string {
  return NODE_LABELS[node] ?? node;
}
