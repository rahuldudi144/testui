import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { Bug } from "lucide-react";
import { formatStateFieldValue } from "./formatStateValue";

export interface StateTimelineStep {
  step: number;
  node: string;
  label: string;
  changed: string[];
  changes?: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}

const NODE_LABELS: Record<string, string> = {
  planner: "Planner",
  answer: "Answer",
  schemaResolver: "Schema resolver",
  buildQuery: "Build query",
  validateQuery: "Validate query",
  runQuery: "Run query",
  formatResponse: "Format response",
  verifyAnswer: "Verify answer",
};

function buildStepsFromHistory(
  history: Array<Record<string, unknown>>,
): StateTimelineStep[] {
  const snapshot: Record<string, unknown> = {};
  const steps: StateTimelineStep[] = [];

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    const node = typeof item.node === "string" ? item.node : "unknown";
    const step = typeof item.step === "number" ? item.step : i + 1;
    const changes =
      item.changes && typeof item.changes === "object" && !Array.isArray(item.changes)
        ? (item.changes as Record<string, unknown>)
        : {};
    Object.assign(snapshot, changes);
    steps.push({
      step,
      node,
      label: NODE_LABELS[node] ?? node,
      changed: Object.keys(changes),
      changes,
      snapshot: { ...snapshot },
    });
  }

  return steps;
}

export function parseStateTimelineFromDebug(
  debug: Record<string, unknown>,
): StateTimelineStep[] {
  const output =
    debug.output && typeof debug.output === "object"
      ? (debug.output as Record<string, unknown>)
      : null;
  const outputSql =
    typeof output?.generatedSql === "string" ? output.generatedSql : null;

  const enrichSql = (steps: StateTimelineStep[]): StateTimelineStep[] => {
    if (!outputSql) return steps;
    return steps.map((step) => {
      const snapshot = { ...step.snapshot };
      if (!snapshot.generatedSql) snapshot.generatedSql = outputSql;
      const changes = step.changes ? { ...step.changes } : undefined;
      if (changes && !changes.generatedSql && step.changed.includes("generatedSql")) {
        changes.generatedSql = outputSql;
      }
      return { ...step, snapshot, changes };
    });
  };

  const rawTimeline = debug.stateTimeline;
  if (Array.isArray(rawTimeline) && rawTimeline.length > 0) {
    return enrichSql(
      rawTimeline
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item, index) => {
        const changes =
          item.changes &&
          typeof item.changes === "object" &&
          !Array.isArray(item.changes)
            ? (item.changes as Record<string, unknown>)
            : undefined;
        return {
          step: typeof item.step === "number" ? item.step : index + 1,
          node: typeof item.node === "string" ? item.node : "unknown",
          label:
            typeof item.label === "string"
              ? item.label
              : NODE_LABELS[String(item.node)] ?? String(item.node ?? "unknown"),
          changed: Array.isArray(item.changed)
            ? item.changed.filter((k): k is string => typeof k === "string")
            : changes
              ? Object.keys(changes)
              : [],
          changes,
          snapshot:
            item.snapshot && typeof item.snapshot === "object" && !Array.isArray(item.snapshot)
              ? (item.snapshot as Record<string, unknown>)
              : {},
        };
      }),
    );
  }

  const rawHistory = debug.stateHistory;
  if (Array.isArray(rawHistory) && rawHistory.length > 0) {
    return enrichSql(
      buildStepsFromHistory(
        rawHistory.filter((item): item is Record<string, unknown> => !!item && typeof item === "object"),
      ),
    );
  }

  const graph = debug.graph;
  if (graph && typeof graph === "object") {
    const record = graph as Record<string, unknown>;
    const path = Array.isArray(record.path)
      ? record.path.filter((p): p is string => typeof p === "string")
      : [];
    const nodes = Array.isArray(record.nodes)
      ? (record.nodes as Array<Record<string, unknown>>)
      : [];

    const snapshot: Record<string, unknown> = {};
    const input =
      debug.input && typeof debug.input === "object"
        ? (debug.input as Record<string, unknown>)
        : null;
    if (input?.query) snapshot.query = input.query;
    if (input?.dryRun !== undefined) snapshot.dryRun = input.dryRun;

    return enrichSql(
      path.map((nodeId, index) => {
      const node = nodes.find((n) => n.id === nodeId);
      const state =
        node?.state && typeof node.state === "object"
          ? (node.state as Record<string, unknown>)
          : {};
      Object.assign(snapshot, state);
      return {
        step: index + 1,
        node: nodeId,
        label: NODE_LABELS[nodeId] ?? nodeId,
        changed: Array.isArray(node?.stateChanges)
          ? (node.stateChanges as string[])
          : [],
        snapshot: { ...snapshot },
      };
      }),
    );
  }

  return [];
}

interface Props {
  steps: StateTimelineStep[];
}

export function StateNavView({ steps }: Props) {
  const [selectedStep, setSelectedStep] = useState(steps[0]?.step ?? 1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const activeStep = useMemo(
    () => steps.find((s) => s.step === selectedStep) ?? steps.at(-1),
    [steps, selectedStep],
  );

  const changeKeys = useMemo(
    () => (activeStep?.changes ? Object.keys(activeStep.changes) : activeStep?.changed ?? []),
    [activeStep],
  );

  const snapshotKeys = useMemo(
    () => (activeStep ? Object.keys(activeStep.snapshot).sort() : []),
    [activeStep],
  );

  useEffect(() => {
    if (steps.length === 0) return;
    const last = steps[steps.length - 1].step;
    setSelectedStep(last);
    setSelectedKey(null);
  }, [steps]);

  useEffect(() => {
    if (snapshotKeys.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !snapshotKeys.includes(selectedKey)) {
      setSelectedKey(snapshotKeys[0]);
    }
  }, [snapshotKeys, selectedKey]);

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={Bug}
        title="No state timeline"
        description="Send a new message to capture per-node state transitions."
        className="py-8"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Steps
        </p>
        <div className="flex gap-1 overflow-x-auto overscroll-x-contain pb-0.5">
          {steps.map((step) => (
            <button
              key={`step-${step.step}`}
              type="button"
              onClick={() => {
                setSelectedStep(step.step);
                setSelectedKey(null);
              }}
              className={cn(
                "shrink-0 rounded-md border px-2 py-1 text-left transition-colors focus-ring",
                selectedStep === step.step
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted/50",
              )}
            >
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                #{step.step}
              </span>
              <span className="block text-xs font-medium">{step.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeStep && changeKeys.length > 0 && (
        <div className="shrink-0 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Changed at this step
          </p>
          <div className="flex flex-wrap gap-1">
            {changeKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                className="focus-ring rounded-full"
              >
                <Badge variant="info" className="normal-case">
                  {key}
                </Badge>
              </button>
            ))}
          </div>
          {activeStep.changes && (
            <div className="space-y-1.5 rounded-lg border border-border bg-background p-2">
              {changeKeys.map((key) => (
                <div key={key} className="rounded-md bg-muted/20 px-2 py-1.5">
                  <p className="text-[10px] font-medium text-muted-foreground">{key}</p>
                  <pre className="mt-0.5 wrap-break-word whitespace-pre-wrap font-mono text-[11px] text-foreground">
                    {formatStateFieldValue(key, activeStep.changes?.[key])}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <nav
          aria-label="State fields"
          className="flex w-[38%] min-w-[100px] shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-1"
        >
          {snapshotKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              className={cn(
                "rounded-md px-2 py-1.5 text-left text-[11px] font-mono transition-colors focus-ring",
                selectedKey === key
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted/60",
                changeKeys.includes(key) && selectedKey !== key && "text-info",
              )}
            >
              {key}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-3">
          {selectedKey && activeStep ? (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {selectedKey}
                {changeKeys.includes(selectedKey) && (
                  <span className="ml-2 normal-case text-info">changed this step</span>
                )}
              </p>
              <pre className="mt-2 wrap-break-word whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
                {formatStateFieldValue(selectedKey, activeStep.snapshot[selectedKey])}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Select a state field.</p>
          )}
        </div>
      </div>
    </div>
  );
}
