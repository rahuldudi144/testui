import type { GraphEdge, RelationshipGraph } from "./relationshipGraph";

export interface LayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  outDegree: number;
  inDegree: number;
  layer: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  columns: string[];
  curveOffset: number;
}

export interface RelationshipGraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const NODE_HEIGHT = 32;
const MIN_NODE_WIDTH = 96;
const MAX_NODE_WIDTH = 176;
const CHAR_WIDTH = 6.2;
const NODE_PADDING_X = 22;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 72;
const CANVAS_PAD = 56;
const COMPONENT_GAP = 96;

function nodeWidth(label: string): number {
  return Math.min(
    MAX_NODE_WIDTH,
    Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + NODE_PADDING_X),
  );
}

function collectNodesAndEdges(graph: RelationshipGraph): {
  nodeIds: string[];
  edgeGroups: Map<string, { from: string; to: string; columns: string[] }>;
  outDegree: Map<string, number>;
  inDegree: Map<string, number>;
} {
  const nodeSet = new Set<string>();
  const edgeGroups = new Map<string, { from: string; to: string; columns: string[] }>();
  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();

  const bump = (map: Map<string, number>, id: string, delta: number) => {
    map.set(id, (map.get(id) ?? 0) + delta);
  };

  for (const [sourceKey, edges] of Object.entries(graph)) {
    nodeSet.add(sourceKey);
    if (!outDegree.has(sourceKey)) outDegree.set(sourceKey, 0);
    if (!inDegree.has(sourceKey)) inDegree.set(sourceKey, 0);

    for (const edge of edges) {
      const from = edge.fromTable || sourceKey;
      const to = edge.toTable;
      nodeSet.add(from);
      nodeSet.add(to);

      const key = `${from}->${to}`;
      const existing = edgeGroups.get(key);
      if (existing) {
        if (!existing.columns.includes(edge.fromColumn)) {
          existing.columns.push(edge.fromColumn);
        }
      } else {
        edgeGroups.set(key, { from, to, columns: [edge.fromColumn] });
        bump(outDegree, from, 1);
        bump(inDegree, to, 1);
      }
    }
  }

  return {
    nodeIds: [...nodeSet].sort(),
    edgeGroups,
    outDegree,
    inDegree,
  };
}

function findComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): string[][] {
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function unite(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  for (const edge of edges) unite(edge.from, edge.to);

  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  return [...groups.values()]
    .map((ids) => ids.sort())
    .sort((a, b) => b.length - a.length);
}

function assignLayers(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): Map<string, number> {
  const layer = new Map<string, number>();
  for (const id of nodeIds) layer.set(id, 0);

  const maxPasses = Math.max(nodeIds.length, 4);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const edge of edges) {
      const next = (layer.get(edge.to) ?? 0) + 1;
      if ((layer.get(edge.from) ?? 0) < next) {
        layer.set(edge.from, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return layer;
}

function orderLayer(
  layerNodes: string[],
  edges: Array<{ from: string; to: string }>,
  positions: Map<string, number>,
  layerIndex: number,
  layers: Map<number, string[]>,
): string[] {
  if (layerIndex === 0 || layerNodes.length <= 1) {
    return [...layerNodes].sort();
  }

  const prevLayer = layers.get(layerIndex - 1) ?? [];
  const prevIndex = new Map(prevLayer.map((id, index) => [id, index]));

  function barycenter(id: string): number {
    const neighbors = edges
      .filter((e) => e.from === id && prevIndex.has(e.to))
      .map((e) => prevIndex.get(e.to)!);
    if (neighbors.length === 0) {
      const forward = edges
        .filter((e) => e.to === id && positions.has(e.from))
        .map((e) => positions.get(e.from)!);
      if (forward.length > 0) {
        return forward.reduce((sum, v) => sum + v, 0) / forward.length;
      }
      return Number.POSITIVE_INFINITY;
    }
    return neighbors.reduce((sum, v) => sum + v, 0) / neighbors.length;
  }

  return [...layerNodes].sort((a, b) => {
    const ba = barycenter(a);
    const bb = barycenter(b);
    if (ba !== bb) return ba - bb;
    return a.localeCompare(b);
  });
}

function layoutComponent(
  nodeIds: string[],
  edgeGroups: Map<string, { from: string; to: string; columns: string[] }>,
  outDegree: Map<string, number>,
  inDegree: Map<string, number>,
  yOffset: number,
): { nodes: LayoutNode[]; width: number; height: number } {
  const edges = [...edgeGroups.values()].filter(
    (e) => nodeIds.includes(e.from) && nodeIds.includes(e.to),
  );

  const layerMap = assignLayers(nodeIds, edges);
  const maxLayer = Math.max(...[...layerMap.values()], 0);

  const layers = new Map<number, string[]>();
  for (const id of nodeIds) {
    const layer = layerMap.get(id) ?? 0;
    const list = layers.get(layer) ?? [];
    list.push(id);
    layers.set(layer, list);
  }

  const positions = new Map<string, number>();
  const rowWidths: number[] = [];

  for (let layer = 0; layer <= maxLayer; layer++) {
    const ordered = orderLayer(
      layers.get(layer) ?? [],
      edges,
      positions,
      layer,
      layers,
    );
    layers.set(layer, ordered);

    let x = 0;
    for (const id of ordered) {
      const width = nodeWidth(id);
      positions.set(id, x + width / 2);
      x += width + HORIZONTAL_GAP;
    }
    rowWidths.push(Math.max(0, x - HORIZONTAL_GAP));
  }

  const contentWidth = Math.max(...rowWidths, MIN_NODE_WIDTH);
  const nodes: LayoutNode[] = [];

  for (let layer = 0; layer <= maxLayer; layer++) {
    const ordered = layers.get(layer) ?? [];
    const rowWidth = rowWidths[layer] ?? 0;
    const startX = CANVAS_PAD + (contentWidth - rowWidth) / 2;
    let x = startX;

    for (const id of ordered) {
      const width = nodeWidth(id);
      nodes.push({
        id,
        label: id,
        x,
        y: yOffset + CANVAS_PAD + layer * (NODE_HEIGHT + VERTICAL_GAP),
        width,
        height: NODE_HEIGHT,
        outDegree: outDegree.get(id) ?? 0,
        inDegree: inDegree.get(id) ?? 0,
        layer,
      });
      x += width + HORIZONTAL_GAP;
    }
  }

  const height =
    CANVAS_PAD * 2 +
    (maxLayer + 1) * NODE_HEIGHT +
    maxLayer * VERTICAL_GAP;

  return {
    nodes,
    width: contentWidth + CANVAS_PAD * 2,
    height,
  };
}

export function layoutRelationshipGraph(
  graph: RelationshipGraph,
): RelationshipGraphLayout {
  const { nodeIds, edgeGroups, outDegree, inDegree } =
    collectNodesAndEdges(graph);

  if (nodeIds.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const uniqueEdges = [...edgeGroups.values()];
  const components = findComponents(nodeIds, uniqueEdges);

  const allNodes: LayoutNode[] = [];
  let yOffset = 0;
  let maxWidth = 0;
  let totalHeight = 0;

  for (let i = 0; i < components.length; i++) {
    const component = components[i]!;
    const placed = layoutComponent(
      component,
      edgeGroups,
      outDegree,
      inDegree,
      yOffset,
    );
    allNodes.push(...placed.nodes);
    maxWidth = Math.max(maxWidth, placed.width);
    yOffset += placed.height + (i < components.length - 1 ? COMPONENT_GAP : 0);
    totalHeight = yOffset;
  }

  const parallelIndex = new Map<string, number>();
  const parallelTotal = new Map<string, number>();
  for (const group of edgeGroups.values()) {
    const pair =
      group.from < group.to
        ? `${group.from}|${group.to}`
        : `${group.to}|${group.from}`;
    parallelTotal.set(pair, (parallelTotal.get(pair) ?? 0) + 1);
  }

  const layoutEdges: LayoutEdge[] = [...edgeGroups.entries()].map(
    ([key, group]) => {
      const pair =
        group.from < group.to
          ? `${group.from}|${group.to}`
          : `${group.to}|${group.from}`;
      const index = parallelIndex.get(pair) ?? 0;
      parallelIndex.set(pair, index + 1);
      const total = parallelTotal.get(pair) ?? 1;
      const curveOffset = total <= 1 ? 0 : (index - (total - 1) / 2) * 36;

      return {
        id: key,
        from: group.from,
        to: group.to,
        columns: group.columns.sort(),
        curveOffset,
      };
    },
  );

  return {
    nodes: allNodes,
    edges: layoutEdges,
    width: Math.max(480, maxWidth),
    height: Math.max(320, totalHeight),
  };
}

/** Top-down FK edge: child below, parent above. */
export function edgePath(
  from: LayoutNode,
  to: LayoutNode,
  curveOffset: number,
): string {
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;

  const fromIsBelow = from.y > to.y;
  const start = fromIsBelow
    ? { x: fromCenterX, y: from.y }
    : { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = fromIsBelow
    ? { x: toCenterX, y: to.y + to.height }
    : { x: to.x, y: to.y + to.height / 2 };

  if (fromIsBelow) {
    const midY = (start.y + end.y) / 2;
    const c1x = start.x + curveOffset;
    const c2x = end.x + curveOffset;
    return `M ${start.x} ${start.y} C ${c1x} ${midY}, ${c2x} ${midY}, ${end.x} ${end.y}`;
  }

  const midX = (start.x + end.x) / 2;
  return `M ${start.x} ${start.y} C ${midX} ${start.y + curveOffset}, ${midX} ${end.y - curveOffset}, ${end.x} ${end.y}`;
}

export function flattenEdgesForLayout(graph: RelationshipGraph): GraphEdge[] {
  const rows: GraphEdge[] = [];
  for (const edges of Object.values(graph)) {
    rows.push(...edges);
  }
  return rows;
}
