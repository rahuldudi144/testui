export interface JoinCondition {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isJoinCondition(value: unknown): value is JoinCondition {
  if (!isRecord(value)) return false;
  return (
    typeof value.leftTable === "string" &&
    typeof value.leftColumn === "string" &&
    typeof value.rightTable === "string" &&
    typeof value.rightColumn === "string"
  );
}

export function isJoinPaths(value: unknown): value is JoinCondition[] {
  return Array.isArray(value) && value.length > 0 && value.every(isJoinCondition);
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");
}

function readNodeField(
  steps: Array<Record<string, unknown>>,
  node: string,
  key: string,
): unknown | undefined {
  for (const step of steps) {
    if (step.node !== node) continue;
    const changes = isRecord(step.changes) ? step.changes : null;
    if (changes && key in changes) return changes[key];
    const snapshot = isRecord(step.snapshot) ? step.snapshot : null;
    if (snapshot && key in snapshot) return snapshot[key];
  }
  return undefined;
}

function collectDebugSteps(debug: Record<string, unknown>): Array<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [];

  if (Array.isArray(debug.stateHistory)) {
    for (const entry of debug.stateHistory) {
      if (isRecord(entry)) steps.push(entry);
    }
  }

  if (Array.isArray(debug.stateTimeline)) {
    for (const entry of debug.stateTimeline) {
      if (isRecord(entry)) steps.push(entry);
    }
  }

  return steps;
}

function readWorkflowNodeState(
  debug: Record<string, unknown>,
  nodeId: string,
  key: string,
): unknown | undefined {
  const workflowGraph = debug.graph;
  if (!isRecord(workflowGraph) || !Array.isArray(workflowGraph.nodes)) return undefined;

  for (const node of workflowGraph.nodes) {
    if (!isRecord(node) || node.id !== nodeId) continue;
    const state = isRecord(node.state) ? node.state : null;
    if (state && key in state) return state[key];
  }

  return undefined;
}

export function parseNodeFieldFromDebug<T>(
  debug: Record<string, unknown>,
  node: string,
  key: string,
  validate: (value: unknown) => value is T,
): T | null {
  const fromSteps = readNodeField(collectDebugSteps(debug), node, key);
  if (validate(fromSteps)) return fromSteps;

  const fromWorkflow = readWorkflowNodeState(debug, node, key);
  if (validate(fromWorkflow)) return fromWorkflow;

  return null;
}

export function parseJoinPathsFromDebug(
  debug: Record<string, unknown>,
): JoinCondition[] | null {
  return parseNodeFieldFromDebug(debug, "pathFinder", "joinPaths", isJoinPaths);
}

export function parseOperationsFromDebug(debug: Record<string, unknown>): string[] | null {
  return parseNodeFieldFromDebug(debug, "operationPlanner", "operations", isStringList);
}

export function parseEntitiesFromDebug(debug: Record<string, unknown>): string[] | null {
  return (
    parseNodeFieldFromDebug(debug, "knowledgeExpansion", "entities", isStringList) ??
    parseNodeFieldFromDebug(debug, "entityExtractor", "businessConcepts", isStringList) ??
    parseNodeFieldFromDebug(debug, "entityExtractor", "entities", isStringList)
  );
}

export function parseBusinessConceptsFromDebug(
  debug: Record<string, unknown>,
): string[] | null {
  return parseNodeFieldFromDebug(
    debug,
    "entityExtractor",
    "businessConcepts",
    isStringList,
  );
}

export function parseStartingDocumentIdsFromDebug(
  debug: Record<string, unknown>,
): string[] | null {
  return parseNodeFieldFromDebug(
    debug,
    "semanticSearch",
    "startingDocumentIds",
    isStringList,
  );
}
