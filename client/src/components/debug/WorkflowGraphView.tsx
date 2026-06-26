import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, XCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { StateValueView } from "./StateValueView";

export type NodeRunStatus = "success" | "failed" | "skipped" | "pending";

export interface NodeVisit {
  step: number;
  changes: Record<string, unknown>;
}

export interface WorkflowGraphNode {
  id: string;
  label: string;
  status: NodeRunStatus;
  order?: number;
  durationMs?: number;
  stateChanges: string[];
  state: Record<string, unknown>;
  runCount?: number;
  visits?: NodeVisit[];
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
  label?: string;
  taken: boolean;
}

export interface PathStep {
  step: number;
  node: string;
}

export interface WorkflowGraphData {
  path: string[];
  pathSteps?: PathStep[];
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

const NODE_LAYOUT: Record<string, { row: number; col: number }> = {
  planner: { row: 0, col: 1 },
  schemaResolver: { row: 1, col: 1 },
  graphBuilder: { row: 2, col: 1 },
  entityExtractor: { row: 3, col: 1 },
  pathFinder: { row: 4, col: 1 },
  operationPlanner: { row: 5, col: 1 },
  buildQuery: { row: 6, col: 1 },
  validateQuery: { row: 7, col: 1 },
  runQuery: { row: 8, col: 2 },
  repairQuery: { row: 8, col: 0 },
  formatResponse: { row: 9, col: 1 },
  /** Terminal / failure path */
  answer: { row: 10, col: 0 },
};

/** Retry / branch edges — drawn as curves so they don't overlap forward paths. */
const CURVED_EDGE_KEYS = new Set([
  "planner->answer",
  "validateQuery->buildQuery",
  "validateQuery->answer",
  "runQuery->repairQuery",
  "runQuery->answer",
  "repairQuery->validateQuery",
]);

function shouldUseCurvedEdge(
  from: { x: number; y: number },
  to: { x: number; y: number },
  edgeKey: string,
): boolean {
  if (CURVED_EDGE_KEYS.has(edgeKey)) return true;
  // Upward or long horizontal jumps between non-adjacent grid cells
  if (to.y < from.y - 24) return true;
  if (Math.abs(to.x - from.x) > 72 && Math.abs(to.y - from.y) < 48) return true;
  return false;
}

function statusVariant(
  status: NodeRunStatus,
): "success" | "destructive" | "outline" {
  if (status === "success") return "success";
  if (status === "failed") return "destructive";
  return "outline";
}

function StatusIcon({ status }: { status: NodeRunStatus }) {
  if (status === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />;
}

function curvedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  edgeKey: string,
): string {
  if (
    edgeKey === "validateQuery->answer" ||
    edgeKey === "runQuery->answer" ||
    edgeKey === "planner->answer"
  ) {
    const laneX = Math.min(from.x, to.x) - 36;
    return `M ${from.x} ${from.y} C ${laneX} ${from.y}, ${laneX} ${to.y}, ${to.x} ${to.y}`;
  }

  const dx = to.x - from.x;
  let offsetX = -Math.min(80, Math.abs(dx) * 0.5 + 40);
  if (edgeKey === "runQuery->answer") {
    offsetX = -90;
  } else if (edgeKey === "planner->answer") {
    offsetX = -70;
  } else if (dx > 0) {
    offsetX = 70;
  }
  const ctrlX = (from.x + to.x) / 2 + offsetX;
  const ctrlY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} Q ${ctrlX} ${ctrlY} ${to.x} ${to.y}`;
}

interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function edgeEndpoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSize: { w: number; h: number },
  toSize: { w: number; h: number },
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const padFrom = Math.min(fromSize.w, fromSize.h) * 0.35;
  const padTo = Math.min(toSize.w, toSize.h) * 0.35;
  return {
    from: { x: from.x + ux * padFrom, y: from.y + uy * padFrom },
    to: { x: to.x - ux * padTo, y: to.y - uy * padTo },
  };
}

function edgeAnchors(
  fromRect: NodeRect,
  toRect: NodeRect,
  edgeKey: string,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const fromCenter = {
    x: fromRect.x + fromRect.w / 2,
    y: fromRect.y + fromRect.h / 2,
  };
  const toCenter = {
    x: toRect.x + toRect.w / 2,
    y: toRect.y + toRect.h / 2,
  };

  if (edgeKey.endsWith("->answer")) {
    return {
      from: edgeEndpoints(fromCenter, toCenter, fromRect, toRect).from,
      to: { x: toRect.x + toRect.w * 0.5, y: toRect.y },
    };
  }

  const sameColumn =
    Math.abs(fromCenter.x - toCenter.x) < Math.min(fromRect.w, toRect.w) * 0.6;
  const flowsDown = toCenter.y > fromCenter.y + 8;

  if (flowsDown && sameColumn && !edgeKey.endsWith("->buildQuery")) {
    return {
      from: { x: fromCenter.x, y: fromRect.y + fromRect.h },
      to: { x: toCenter.x, y: toRect.y },
    };
  }

  if (edgeKey.endsWith("->buildQuery") && fromCenter.y > toCenter.y) {
    return {
      from: { x: fromRect.x + fromRect.w * 0.25, y: fromRect.y },
      to: { x: toRect.x + toRect.w * 0.5, y: toRect.y + toRect.h },
    };
  }

  return edgeEndpoints(fromCenter, toCenter, fromRect, toRect);
}

const NodeCard = forwardRef<
  HTMLButtonElement,
  {
    node: WorkflowGraphNode;
    selected: boolean;
    onSelect: () => void;
  }
>(function NodeCard({ node, selected, onSelect }, ref) {
  const executed = node.status === "success" || node.status === "failed";
  const pos = NODE_LAYOUT[node.id] ?? { row: 0, col: 0 };

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      style={{
        gridRow: pos.row + 1,
        gridColumn: pos.col + 1,
      }}
      className={cn(
        "relative z-1 rounded-lg border bg-card px-3 py-2 text-left transition-colors focus-ring",
        executed
          ? node.status === "failed"
            ? "border-destructive/40 bg-destructive/5"
            : "border-success/40 bg-success/5"
          : "border-border/60 bg-muted/20 opacity-60",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={node.status} />
        <span className="text-xs font-medium text-foreground">{node.label}</span>
        {node.runCount !== undefined && node.runCount > 1 && (
          <Badge variant="info" className="ml-auto normal-case">
            ×{node.runCount}
          </Badge>
        )}
        {node.order !== undefined && node.runCount === undefined && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            #{node.order}
          </span>
        )}
        {node.order !== undefined && node.runCount !== undefined && node.runCount <= 1 && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            #{node.order}
          </span>
        )}
      </div>
      {node.durationMs !== undefined && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {node.durationMs} ms
        </p>
      )}
    </button>
  );
});

function GraphEdges({
  edges,
  nodeRects,
  size,
}: {
  edges: WorkflowGraphEdge[];
  nodeRects: Record<string, NodeRect>;
  size: { width: number; height: number };
}) {
  if (size.width <= 0 || size.height <= 0) return null;

  return (
    <svg
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      aria-hidden
    >
      {edges.map((edge) => {
        const fromRect = nodeRects[edge.from];
        const toRect = nodeRects[edge.to];
        if (!fromRect || !toRect) return null;

        const fromCenter = {
          x: fromRect.x + fromRect.w / 2,
          y: fromRect.y + fromRect.h / 2,
        };
        const toCenter = {
          x: toRect.x + toRect.w / 2,
          y: toRect.y + toRect.h / 2,
        };

        const edgeKey = `${edge.from}->${edge.to}`;
        const { from, to } = edgeAnchors(fromRect, toRect, edgeKey);

        const stroke = edge.taken ? "var(--primary)" : "var(--border)";
        const opacity = edge.taken ? 0.9 : 0.4;
        const strokeWidth = edge.taken ? 2 : 1;

        if (shouldUseCurvedEdge(fromCenter, toCenter, edgeKey)) {
          return (
            <path
              key={edgeKey}
              d={curvedPath(from, to, edgeKey)}
              fill="none"
              strokeWidth={strokeWidth}
              stroke={stroke}
              strokeOpacity={opacity}
              strokeDasharray={edge.taken ? undefined : "4 4"}
            />
          );
        }

        return (
          <line
            key={edgeKey}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={strokeWidth}
            stroke={stroke}
            strokeOpacity={opacity}
            strokeDasharray={edge.taken ? undefined : "4 4"}
          />
        );
      })}
    </svg>
  );
}

function EdgeLegend({ edges }: { edges: WorkflowGraphEdge[] }) {
  const taken = edges.filter((e) => e.taken);
  if (taken.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {taken.map((edge) => (
        <Badge key={`${edge.from}-${edge.to}`} variant="info" className="normal-case">
          {edge.from}
          <ArrowRight className="mx-1 inline h-3 w-3" aria-hidden />
          {edge.to}
          {edge.label ? ` (${edge.label})` : ""}
        </Badge>
      ))}
    </div>
  );
}

function StatePanel({
  node,
  selectedVisitStep,
  onSelectVisit,
}: {
  node: WorkflowGraphNode;
  selectedVisitStep?: number;
  onSelectVisit: (step: number) => void;
}) {
  const visits = node.visits ?? [];
  const activeVisit =
    visits.find((v) => v.step === selectedVisitStep) ?? visits.at(-1);
  const displayState =
    activeVisit && visits.length > 0 ? activeVisit.changes : node.state;
  const entries = Object.entries(displayState).filter(([key]) => key !== "runCount");

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground">{node.label}</h4>
        <Badge variant={statusVariant(node.status)} className="normal-case">
          {node.status}
        </Badge>
      </div>

      {visits.length > 1 && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Visits
          </p>
          <div className="flex flex-wrap gap-1">
            {visits.map((visit) => (
              <button
                key={visit.step}
                type="button"
                onClick={() => onSelectVisit(visit.step)}
                className="focus-ring rounded-full"
              >
                <Badge
                  variant={activeVisit?.step === visit.step ? "info" : "outline"}
                  className="normal-case"
                >
                  #{visit.step}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {node.stateChanges.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            State changes
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {node.stateChanges.map((key) => (
              <Badge key={key} variant="outline" className="normal-case">
                {key}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {entries.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Values
            {activeVisit && visits.length > 1 && (
              <span className="ml-1 normal-case text-muted-foreground">
                (step #{activeVisit.step})
              </span>
            )}
          </p>
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5"
            >
              <p className="text-[10px] font-medium text-muted-foreground">{key}</p>
              <div className="mt-0.5">
                <StateValueView fieldKey={key} value={value} compact />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {node.status === "skipped"
            ? "This node was not executed on this run."
            : "No state values captured for this node."}
        </p>
      )}
    </div>
  );
}

interface Props {
  graph: WorkflowGraphData;
}

export function WorkflowGraphView({ graph }: Props) {
  const pathSteps = graph.pathSteps ?? graph.path.map((node, i) => ({ step: i + 1, node }));

  const visitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const step of pathSteps) {
      counts.set(step.node, (counts.get(step.node) ?? 0) + 1);
    }
    return counts;
  }, [pathSteps]);

  const executedNodes = useMemo(
    () => graph.nodes.filter((n) => n.status === "success" || n.status === "failed"),
    [graph.nodes],
  );

  const defaultPathIndex = pathSteps.length > 0 ? pathSteps.length - 1 : 0;
  const [selectedPathIndex, setSelectedPathIndex] = useState(defaultPathIndex);
  const [selectedVisitStep, setSelectedVisitStep] = useState<number | undefined>();

  useEffect(() => {
    setSelectedPathIndex(defaultPathIndex);
    setSelectedVisitStep(undefined);
  }, [defaultPathIndex, graph.path.join("|")]);

  const selectedPathStep = pathSteps[selectedPathIndex];
  const selectedId = selectedPathStep?.node ?? executedNodes.at(-1)?.id;
  const selected = graph.nodes.find((n) => n.id === selectedId) ?? executedNodes.at(-1);

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [nodeRects, setNodeRects] = useState<Record<string, NodeRect>>({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const measureGraph = useCallback(() => {
    const container = graphContainerRef.current;
    if (!container) return;

    const containerBox = container.getBoundingClientRect();
    setContainerSize({
      width: containerBox.width,
      height: containerBox.height,
    });

    const next: Record<string, NodeRect> = {};
    for (const [id, el] of nodeRefs.current) {
      const r = el.getBoundingClientRect();
      next[id] = {
        x: r.left - containerBox.left,
        y: r.top - containerBox.top,
        w: r.width,
        h: r.height,
      };
    }
    setNodeRects(next);
  }, []);

  useLayoutEffect(() => {
    measureGraph();
  }, [measureGraph, graph.nodes, graph.edges, graph.path.join("|")]);

  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestAnimationFrame(() => measureGraph());
        }
      },
      { threshold: 0.01 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureGraph]);

  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => measureGraph());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureGraph]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const fonts = document.fonts;
    if (!fonts?.ready) return;
    void fonts.ready.then(() => measureGraph());
  }, [measureGraph]);

  useEffect(() => {
    if (selectedPathStep && selected?.visits?.length) {
      const match = selected.visits.find((v) => v.step === selectedPathStep.step);
      setSelectedVisitStep(match?.step ?? selected.visits.at(-1)?.step);
    }
  }, [selectedPathStep, selected]);

  return (
    <div className="space-y-4">
      {pathSteps.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Execution path
          </p>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {pathSteps.map((pathStep, index) => {
              const visitNum = pathSteps
                .slice(0, index + 1)
                .filter((s) => s.node === pathStep.node).length;
              const totalVisits = visitCounts.get(pathStep.node) ?? 1;
              const showVisitBadge = totalVisits > 1;

              return (
                <span key={`${pathStep.node}-${pathStep.step}`} className="flex items-center gap-1">
                  {index > 0 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPathIndex(index);
                      setSelectedVisitStep(pathStep.step);
                    }}
                    className={cn(
                      "rounded-md border px-2 py-0.5 font-mono transition-colors focus-ring",
                      selectedPathIndex === index
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-muted/40",
                    )}
                  >
                    {pathStep.node}
                    {showVisitBadge && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        ×{visitNum}
                      </span>
                    )}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <EdgeLegend edges={graph.edges} />

      <div
        ref={graphContainerRef}
        className="relative min-h-[420px] rounded-lg border border-border bg-card/40 p-3"
      >
        <div
          className="relative grid gap-3"
          style={{
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gridTemplateRows: "repeat(11, auto)",
          }}
        >
          {graph.nodes.map((node) => (
            <NodeCard
              key={node.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el);
                else nodeRefs.current.delete(node.id);
              }}
              node={node}
              selected={selected?.id === node.id}
              onSelect={() => {
                const lastIndex = pathSteps.map((s) => s.node).lastIndexOf(node.id);
                if (lastIndex >= 0) {
                  setSelectedPathIndex(lastIndex);
                  const step = pathSteps[lastIndex];
                  setSelectedVisitStep(step.step);
                }
              }}
            />
          ))}
        </div>
        <GraphEdges
          edges={graph.edges}
          nodeRects={nodeRects}
          size={containerSize}
        />
      </div>

      {selected && (
        <StatePanel
          node={selected}
          selectedVisitStep={selectedVisitStep}
          onSelectVisit={setSelectedVisitStep}
        />
      )}
    </div>
  );
}

function parseNode(raw: Record<string, unknown>): WorkflowGraphNode {
  const visits = Array.isArray(raw.visits)
    ? (raw.visits as Array<Record<string, unknown>>)
        .filter((v) => typeof v.step === "number")
        .map((v) => ({
          step: v.step as number,
          changes:
            v.changes && typeof v.changes === "object" && !Array.isArray(v.changes)
              ? (v.changes as Record<string, unknown>)
              : {},
        }))
    : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : "unknown",
    label: typeof raw.label === "string" ? raw.label : String(raw.id ?? "unknown"),
    status: (raw.status as NodeRunStatus) ?? "skipped",
    order: typeof raw.order === "number" ? raw.order : undefined,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    stateChanges: Array.isArray(raw.stateChanges)
      ? raw.stateChanges.filter((k): k is string => typeof k === "string")
      : [],
    state:
      raw.state && typeof raw.state === "object" && !Array.isArray(raw.state)
        ? (raw.state as Record<string, unknown>)
        : {},
    runCount: typeof raw.runCount === "number" ? raw.runCount : undefined,
    visits,
  };
}

export function parseGraphFromDebug(
  debug: Record<string, unknown>,
): WorkflowGraphData | null {
  const graph = debug.graph;
  if (graph && typeof graph === "object") {
    const record = graph as Record<string, unknown>;
    if (Array.isArray(record.nodes) && Array.isArray(record.path)) {
      const pathSteps = Array.isArray(record.pathSteps)
        ? (record.pathSteps as Array<Record<string, unknown>>)
            .filter((s) => typeof s.node === "string" && typeof s.step === "number")
            .map((s) => ({ step: s.step as number, node: s.node as string }))
        : undefined;

      return {
        path: record.path.filter((p): p is string => typeof p === "string"),
        pathSteps,
        nodes: (record.nodes as Array<Record<string, unknown>>).map(parseNode),
        edges: Array.isArray(record.edges)
          ? (record.edges as WorkflowGraphEdge[])
          : [],
      };
    }
  }

  const workflow =
    debug.workflow && typeof debug.workflow === "object"
      ? (debug.workflow as Record<string, unknown>)
      : null;
  const metrics =
    debug.metrics && typeof debug.metrics === "object"
      ? (debug.metrics as Record<string, unknown>)
      : null;
  const output =
    debug.output && typeof debug.output === "object"
      ? (debug.output as Record<string, unknown>)
      : null;

  const nodesExecuted = Array.isArray(workflow?.nodesExecuted)
    ? (workflow.nodesExecuted as string[])
    : [];

  const timeline = Array.isArray(metrics?.nodeTimeline)
    ? (metrics.nodeTimeline as Array<Record<string, unknown>>)
    : [];

  const pathFromTimeline = timeline
    .filter((e) => e.event === "node_end")
    .map((e) => {
      const node = typeof e.node === "string" ? e.node : null;
      return node === "getSchema" ? "schemaResolver" : node;
    })
    .filter((n): n is string => Boolean(n));

  const path = pathFromTimeline.length > 0 ? pathFromTimeline : nodesExecuted.map((n) =>
    n === "getSchema" ? "schemaResolver" : n,
  );
  if (path.length === 0) return null;

  const ALL = [
    "planner",
    "answer",
    "schemaResolver",
    "graphBuilder",
    "entityExtractor",
    "pathFinder",
    "operationPlanner",
    "buildQuery",
    "validateQuery",
    "runQuery",
    "repairQuery",
    "formatResponse",
  ] as const;

  const labels: Record<string, string> = {
    planner: "Planner",
    answer: "Answer",
    schemaResolver: "Schema resolver",
    graphBuilder: "Relationship graph",
    entityExtractor: "Entity extractor",
    pathFinder: "Path finder",
    operationPlanner: "Operation planner",
    buildQuery: "Build query",
    validateQuery: "Validate query",
    runQuery: "Run query",
    repairQuery: "Repair query",
    formatResponse: "Format response",
  };

  const pathSet = new Set(path);
  const nodes: WorkflowGraphNode[] = ALL.map((id) => {
    const executed = pathSet.has(id);
    const state: Record<string, unknown> = {};

    if (id === "planner" && workflow?.requiresSql !== undefined) {
      state.requiresSql = workflow.requiresSql;
    }
    if (id === "planner" && workflow?.isDomainSpecific !== undefined) {
      state.isDomainSpecific = workflow.isDomainSpecific;
    }
    if (id === "planner" && typeof workflow?.plannerReason === "string") {
      state.plannerReason = workflow.plannerReason;
    }
    if (id === "buildQuery" && typeof output?.generatedSql === "string") {
      state.generatedSql = output.generatedSql;
    }
    if (id === "validateQuery" && workflow?.validationPassed !== undefined) {
      state.validationPassed = workflow.validationPassed;
    }
    if (id === "validateQuery" && workflow?.sqlParserPassed !== undefined) {
      state.sqlParserPassed = workflow.sqlParserPassed;
    }
    if (id === "validateQuery" && typeof workflow?.sqlParserError === "string") {
      state.sqlParserError = workflow.sqlParserError;
    }
    if (id === "validateQuery" && workflow?.sqlParserStats) {
      state.sqlParserStats = workflow.sqlParserStats;
    }

    const runCount = path.filter((n) => n === id).length;

    return {
      id,
      label: labels[id] ?? id,
      status: executed ? "success" : "skipped",
      order: path.lastIndexOf(id) >= 0 ? path.lastIndexOf(id) + 1 : undefined,
      stateChanges: [],
      state,
      runCount: runCount > 1 ? runCount : undefined,
    };
  });

  return { path, nodes, edges: edgesFromPath(path) };
}

const FALLBACK_EDGES: Array<{ from: string; to: string; label?: string }> = [
  { from: "planner", to: "answer", label: "non-SQL / off-domain" },
  { from: "planner", to: "schemaResolver", label: "domain + SQL" },
  { from: "schemaResolver", to: "graphBuilder" },
  { from: "graphBuilder", to: "entityExtractor" },
  { from: "entityExtractor", to: "pathFinder" },
  { from: "pathFinder", to: "operationPlanner" },
  { from: "operationPlanner", to: "buildQuery" },
  { from: "buildQuery", to: "validateQuery" },
  { from: "validateQuery", to: "runQuery", label: "valid" },
  { from: "validateQuery", to: "formatResponse", label: "dry run" },
  { from: "validateQuery", to: "buildQuery", label: "validation retry" },
  { from: "validateQuery", to: "answer", label: "validation exhausted" },
  { from: "runQuery", to: "formatResponse", label: "success" },
  { from: "runQuery", to: "repairQuery", label: "execution retry" },
  { from: "runQuery", to: "answer", label: "execution exhausted" },
  { from: "repairQuery", to: "validateQuery", label: "re-validate" },
];

function edgesFromPath(path: string[]): WorkflowGraphEdge[] {
  const taken = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    taken.add(`${path[i]}->${path[i + 1]}`);
  }
  return FALLBACK_EDGES.map(({ from, to, label }) => ({
    from,
    to,
    label,
    taken: taken.has(`${from}->${to}`),
  }));
}
