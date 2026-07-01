import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import {
  relationshipGraphStats,
  type RelationshipGraph,
} from "./relationshipGraph";
import {
  edgePath,
  layoutRelationshipGraph,
  type LayoutEdge,
  type LayoutNode,
} from "./relationshipGraphLayout";

interface Props {
  graph: RelationshipGraph;
  compact?: boolean;
}

function GraphCanvas({
  layout,
  selectedId,
  hoveredEdgeId,
  onSelectNode,
  onHoverEdge,
  compact,
}: {
  layout: ReturnType<typeof layoutRelationshipGraph>;
  selectedId: string | null;
  hoveredEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onHoverEdge: (id: string | null) => void;
  compact: boolean;
}) {
  const nodeMap = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout.nodes],
  );

  const connectedEdges = useMemo(() => {
    if (!selectedId) return null;
    return new Set(
      layout.edges
        .filter((e) => e.from === selectedId || e.to === selectedId)
        .map((e) => e.id),
    );
  }, [layout.edges, selectedId]);

  function edgeStroke(edge: LayoutEdge): string {
    if (hoveredEdgeId === edge.id) return "var(--primary)";
    if (connectedEdges?.has(edge.id)) return "var(--primary)";
    if (selectedId) return "var(--border)";
    return "color-mix(in oklab, var(--muted-foreground) 55%, transparent)";
  }

  function edgeOpacity(edge: LayoutEdge): number {
    if (!selectedId && !hoveredEdgeId) return 0.75;
    if (hoveredEdgeId === edge.id) return 1;
    if (connectedEdges?.has(edge.id)) return 0.95;
    return 0.2;
  }

  function nodeFill(node: LayoutNode): string {
    if (selectedId === node.id) return "color-mix(in oklab, var(--primary) 14%, var(--card))";
    if (connectedEdges && layout.edges.some(
      (e) => connectedEdges.has(e.id) && (e.from === node.id || e.to === node.id),
    )) {
      return "color-mix(in oklab, var(--primary) 8%, var(--card))";
    }
    return "var(--card)";
  }

  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border border-border bg-muted/10",
        compact ? "max-h-72" : "min-h-[360px] max-h-[min(70vh,720px)]",
      )}
    >
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block"
        style={{ minWidth: layout.width, minHeight: layout.height }}
        role="img"
        aria-label="Database relationship graph"
      >
        <defs>
          <marker
            id="fk-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
          </marker>
          <marker
            id="fk-arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary)" />
          </marker>
        </defs>

        <g>
          {layout.edges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;
            const active =
              hoveredEdgeId === edge.id || connectedEdges?.has(edge.id);
            return (
              <g key={edge.id}>
                <path
                  d={edgePath(from, to, edge.curveOffset)}
                  fill="none"
                  stroke={edgeStroke(edge)}
                  strokeOpacity={edgeOpacity(edge)}
                  strokeWidth={active ? 2 : 1.25}
                  markerEnd={active ? "url(#fk-arrow-active)" : "url(#fk-arrow)"}
                  className="pointer-events-none"
                />
                <path
                  d={edgePath(from, to, edge.curveOffset)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-pointer"
                  onMouseEnter={() => onHoverEdge(edge.id)}
                  onMouseLeave={() => onHoverEdge(null)}
                >
                  <title>
                    {edge.from}.{edge.columns.join(", ")} → {edge.to}
                  </title>
                </path>
              </g>
            );
          })}
        </g>

        <g>
          {layout.nodes.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer"
              onClick={() => onSelectNode(selectedId === node.id ? null : node.id)}
            >
              <rect
                width={node.width}
                height={node.height}
                rx={8}
                ry={8}
                fill={nodeFill(node)}
                stroke={
                  selectedId === node.id ? "var(--primary)" : "var(--border)"
                }
                strokeWidth={selectedId === node.id ? 2 : 1}
              />
              <text
                x={node.width / 2}
                y={node.height / 2 + 4}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-medium"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {truncateLabel(node.label, node.width)}
              </text>
              <title>{node.label}</title>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function truncateLabel(label: string, maxWidth: number): string {
  const maxChars = Math.floor((maxWidth - 16) / 6.5);
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(4, maxChars - 1))}…`;
}

function EdgeDetail({ edge, nodes }: { edge: LayoutEdge; nodes: LayoutNode[] }) {
  const from = nodes.find((n) => n.id === edge.from);
  const to = nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;

  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2 text-xs">
      <p className="font-mono text-foreground">
        {from.label}
        <span className="text-muted-foreground">.</span>
        {edge.columns.join(", ")}
        <span className="mx-1.5 text-muted-foreground">→</span>
        {to.label}
      </p>
    </div>
  );
}

function NodeDetail({ node, edges }: { node: LayoutNode; edges: LayoutEdge[] }) {
  const outgoing = edges.filter((e) => e.from === node.id);
  const incoming = edges.filter((e) => e.to === node.id);

  return (
    <div className="space-y-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs">
      <p className="font-mono font-medium text-foreground">{node.label}</p>
      {outgoing.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            References ({outgoing.length})
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground">
            {outgoing.map((e) => (
              <li key={e.id}>
                {e.columns.join(", ")} → {e.to}
              </li>
            ))}
          </ul>
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Referenced by ({incoming.length})
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-foreground">
            {incoming.map((e) => (
              <li key={e.id}>
                {e.from} → {e.columns.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RelationshipGraphView({ graph, compact = false }: Props) {
  const layout = useMemo(() => layoutRelationshipGraph(graph), [graph]);
  const stats = useMemo(() => relationshipGraphStats(graph), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const selectedNode = layout.nodes.find((n) => n.id === selectedId) ?? null;
  const hoveredEdge =
    layout.edges.find((e) => e.id === hoveredEdgeId) ?? null;

  if (layout.nodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No foreign-key edges were recorded in the relationship graph.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="normal-case">
          {stats.tableCount} tables
        </Badge>
        <Badge variant="outline" className="normal-case">
          {stats.edgeCount} FK edges
        </Badge>
        <Badge variant="outline" className="normal-case">
          {layout.edges.length} links
        </Badge>
      </div>

      <GraphCanvas
        layout={layout}
        selectedId={selectedId}
        hoveredEdgeId={hoveredEdgeId}
        onSelectNode={setSelectedId}
        onHoverEdge={setHoveredEdgeId}
        compact={compact}
      />

      {hoveredEdge && !selectedNode && (
        <EdgeDetail edge={hoveredEdge} nodes={layout.nodes} />
      )}

      {selectedNode && (
        <NodeDetail node={selectedNode} edges={layout.edges} />
      )}

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Referenced tables sit above; FK holders below. Arrows flow upward to the parent table.
          Scroll to explore — click a table to focus its links.
        </p>
      )}
    </div>
  );
}
