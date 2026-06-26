import { parseNodeFieldFromDebug } from "./nodeDebugState";

export interface GraphEdge {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** Adjacency list keyed by source table name. */
export type RelationshipGraph = Record<string, GraphEdge[]>;

export interface FlatGraphEdge extends GraphEdge {
  fromTableKey: string;
}

export function isRelationshipGraph(value: unknown): value is RelationshipGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  for (const [table, edges] of Object.entries(value as Record<string, unknown>)) {
    if (typeof table !== "string" || !Array.isArray(edges)) return false;
    for (const edge of edges) {
      if (!isGraphEdge(edge)) return false;
    }
  }

  return Object.keys(value).length > 0;
}

function isGraphEdge(value: unknown): value is GraphEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.fromTable === "string" &&
    typeof edge.fromColumn === "string" &&
    typeof edge.toTable === "string" &&
    typeof edge.toColumn === "string"
  );
}

export function flattenRelationshipGraph(graph: RelationshipGraph): FlatGraphEdge[] {
  const rows: FlatGraphEdge[] = [];

  for (const [fromTableKey, edges] of Object.entries(graph)) {
    for (const edge of edges) {
      rows.push({ ...edge, fromTableKey });
    }
  }

  return rows.sort((a, b) => {
    const tableCmp = a.fromTableKey.localeCompare(b.fromTableKey);
    if (tableCmp !== 0) return tableCmp;
    const fromCmp = a.fromTable.localeCompare(b.fromTable);
    if (fromCmp !== 0) return fromCmp;
    const colCmp = a.fromColumn.localeCompare(b.fromColumn);
    if (colCmp !== 0) return colCmp;
    return a.toTable.localeCompare(b.toTable);
  });
}

export function relationshipGraphStats(graph: RelationshipGraph): {
  tableCount: number;
  edgeCount: number;
} {
  const tables = new Set<string>();
  let edgeCount = 0;

  for (const [key, edges] of Object.entries(graph)) {
    tables.add(key);
    for (const edge of edges) {
      edgeCount += 1;
      tables.add(edge.fromTable);
      tables.add(edge.toTable);
    }
  }

  return { tableCount: tables.size, edgeCount };
}

export function parseRelationshipGraphFromDebug(
  debug: Record<string, unknown>,
): RelationshipGraph | null {
  return parseNodeFieldFromDebug(debug, "graphBuilder", "graph", isRelationshipGraph);
}
