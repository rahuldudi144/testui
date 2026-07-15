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

export function isRelationshipGraph(
  value: unknown,
): value is RelationshipGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  for (const [table, edges] of Object.entries(
    value as Record<string, unknown>,
  )) {
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

export function flattenRelationshipGraph(
  graph: RelationshipGraph,
): FlatGraphEdge[] {
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

export interface RelationshipTreeRoot {
  table: string;
  edges: GraphEdge[];
}

/** Source tables with outgoing FK edges, sorted for tree display. */
export function buildRelationshipTreeRoots(
  graph: RelationshipGraph,
): RelationshipTreeRoot[] {
  return Object.entries(graph)
    .filter(([, edges]) => edges.length > 0)
    .map(([table, edges]) => ({
      table,
      edges: [...edges].sort((a, b) => {
        const toCmp = a.toTable.localeCompare(b.toTable);
        if (toCmp !== 0) return toCmp;
        return a.fromColumn.localeCompare(b.fromColumn);
      }),
    }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/** Tables referenced by FKs but with no outgoing edges in this graph. */
export function referencedOnlyTables(graph: RelationshipGraph): string[] {
  const sources = new Set(Object.keys(graph));
  const targets = new Set<string>();

  for (const edges of Object.values(graph)) {
    for (const edge of edges) {
      targets.add(edge.toTable);
    }
  }

  return [...targets].filter((table) => !sources.has(table)).sort();
}

export function parseRelationshipGraphFromDebug(
  debug: Record<string, unknown>,
): RelationshipGraph | null {
  return (
    parseNodeFieldFromDebug(
      debug,
      "knowledgeLoader",
      "graph",
      isRelationshipGraph,
    ) ??
    parseNodeFieldFromDebug(
      debug,
      "graphBuilder",
      "graph",
      isRelationshipGraph,
    )
  );
}
