import type { GraphNodeName } from "../types/agentEvents";

const NODE_LABELS: Record<GraphNodeName, string> = {
  planner: "Planning",
  knowledgeLoader: "Loading knowledge",
  entityExtractor: "Extracting business concepts",
  semanticSearch: "Semantic search",
  pathFinder: "Finding join paths",
  knowledgeExpansion: "Expanding knowledge",
  operationPlanner: "Planning operations",
  buildQuery: "Generating SQL",
  validateQuery: "Validating SQL",
  runQuery: "Executing query",
  repairQuery: "Repairing SQL",
  formatResponse: "Formatting response",
  answer: "Answering",
};

export function nodeStreamLabel(node: GraphNodeName | string): string {
  return NODE_LABELS[node as GraphNodeName] ?? node;
}
