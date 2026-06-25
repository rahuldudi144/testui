import { useMemo, useState } from "react";
import { Bug, Copy, Check } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { MarkdownContent } from "./ui/MarkdownContent";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/Tabs";
import {
  parseGraphFromDebug,
  WorkflowGraphView,
} from "./debug/WorkflowGraphView";
import {
  parseStateTimelineFromDebug,
  StateNavView,
} from "./debug/StateNavView";
import { StreamEventsView } from "./debug/StreamEventsView";
import type { AgentEvent } from "../types/agentEvents";
import { isAgentEvent } from "../types/agentEvents";

interface Props {
  lastDebug: Record<string, unknown> | null;
  activeRequestId?: string | null;
  isRunning?: boolean;
  liveStreamEvents?: AgentEvent[];
  compact?: boolean;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label="Copy to clipboard"
      onClick={() => void copy()}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 break-all font-mono text-[11px] text-foreground">{value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function LogLevelBadge({ level }: { level: string }) {
  const variant =
    level === "error"
      ? "destructive"
      : level === "warn"
        ? "warning"
        : "outline";
  return (
    <Badge variant={variant} className="shrink-0 normal-case">
      {level}
    </Badge>
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusBadgeVariant(
  status: string,
): "success" | "destructive" | "warning" | "outline" {
  if (status === "success") return "success";
  if (status === "failed") return "destructive";
  if (status === "partial") return "warning";
  return "outline";
}

function validationSourceLabel(source: unknown): string {
  if (source === "safety_guard") return "Safety guard";
  if (source === "sql_parser") return "SQL parser";
  if (source === "llm") return "LLM validator";
  return typeof source === "string" ? source : "unknown";
}

function validationSourceVariant(
  source: unknown,
): "success" | "destructive" | "warning" | "outline" | "info" {
  if (source === "safety_guard") return "warning";
  if (source === "sql_parser") return "info";
  if (source === "llm") return "outline";
  return "outline";
}

function asSqlParserStats(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const DEBUG_TAB_SCROLL =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain";
const DEBUG_TAB_PANEL = "flex min-h-0 flex-1 flex-col overflow-hidden";

export function DebugPanel({
  lastDebug,
  activeRequestId,
  isRunning = false,
  liveStreamEvents = [],
  compact = false,
}: Props) {
  const logs = useMemo(() => {
    if (!lastDebug || !Array.isArray(lastDebug.logs)) return [];
    return lastDebug.logs as Record<string, unknown>[];
  }, [lastDebug]);

  const trace = useMemo(() => asRecord(lastDebug?.trace), [lastDebug]);
  const agent = useMemo(() => asRecord(lastDebug?.agent), [lastDebug]);
  const database = useMemo(() => asRecord(lastDebug?.database), [lastDebug]);
  const input = useMemo(() => asRecord(lastDebug?.input), [lastDebug]);
  const output = useMemo(() => asRecord(lastDebug?.output), [lastDebug]);
  const workflow = useMemo(() => asRecord(lastDebug?.workflow), [lastDebug]);
  const metrics = useMemo(() => asRecord(lastDebug?.metrics), [lastDebug]);
  const totals = useMemo(() => asRecord(metrics?.totals), [metrics]);
  const graph = useMemo(
    () => (lastDebug ? parseGraphFromDebug(lastDebug) : null),
    [lastDebug],
  );
  const stateTimeline = useMemo(
    () => (lastDebug ? parseStateTimelineFromDebug(lastDebug) : []),
    [lastDebug],
  );

  const spans = useMemo(() => {
    if (!trace || !Array.isArray(trace.spans)) return [];
    return trace.spans as Array<Record<string, unknown>>;
  }, [trace]);

  const llmCalls = useMemo(() => {
    if (!metrics || !Array.isArray(metrics.llmCalls)) return [];
    return metrics.llmCalls as Array<Record<string, unknown>>;
  }, [metrics]);

  const dbOps = useMemo(() => {
    if (!metrics || !Array.isArray(metrics.dbOperations)) return [];
    return metrics.dbOperations as Array<Record<string, unknown>>;
  }, [metrics]);

  const validationAttempts = useMemo(() => {
    if (!metrics || !Array.isArray(metrics.validationAttempts)) return [];
    return metrics.validationAttempts as Array<Record<string, unknown>>;
  }, [metrics]);

  const verificationAttempts = useMemo(() => {
    if (!metrics || !Array.isArray(metrics.verificationAttempts)) return [];
    return metrics.verificationAttempts as Array<Record<string, unknown>>;
  }, [metrics]);

  const executionResult = useMemo(() => asRecord(output?.executionResult), [output]);

  const requestId =
    typeof lastDebug?.requestId === "string" ? lastDebug.requestId : null;
  const correlationId =
    typeof lastDebug?.correlationId === "string" ? lastDebug.correlationId : null;
  const workflowStatus =
    typeof workflow?.status === "string" ? workflow.status : null;
  const sqlParserStats = useMemo(
    () => asSqlParserStats(workflow?.sqlParserStats),
    [workflow],
  );

  const streamEvents = useMemo(() => {
    if (isRunning && liveStreamEvents.length > 0) return liveStreamEvents;
    if (!lastDebug || !Array.isArray(lastDebug.streamEvents)) return [];
    return lastDebug.streamEvents.filter(isAgentEvent);
  }, [isRunning, liveStreamEvents, lastDebug]);

  const showPanel = Boolean(lastDebug) || (isRunning && activeRequestId);

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", compact ? "p-3" : "p-4")}>
      {!compact && (
        <header className="mb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">Agent debug</h2>
            {workflowStatus && (
              <Badge
                variant={statusBadgeVariant(workflowStatus)}
                className="ml-auto normal-case"
              >
                {workflowStatus}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Model, workflow state, I/O, and run metrics
            {activeRequestId && !lastDebug && (
              <span className="mt-1 block font-mono text-[10px] text-primary">
                Running: {activeRequestId}
              </span>
            )}
          </p>
        </header>
      )}

      {!showPanel ? (
        <EmptyState
          icon={Bug}
          title="No debug output yet"
          description="Send a message to capture full agent logs, node spans, and request IDs."
          className="py-8"
        />
      ) : (
        <Tabs
          defaultValue={isRunning && !lastDebug ? "stream" : "overview"}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="h-8 w-full max-w-full shrink-0 overflow-x-auto overscroll-x-contain">
            <TabsTrigger value="overview" className="shrink-0 px-2 text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="stream" className="shrink-0 px-2 text-xs">
              Stream ({streamEvents.length})
            </TabsTrigger>
            {lastDebug && (
              <>
            <TabsTrigger value="metrics" className="shrink-0 px-2 text-xs">
              Metrics
            </TabsTrigger>
            <TabsTrigger value="graph" className="shrink-0 px-2 text-xs">
              Graph
            </TabsTrigger>
            <TabsTrigger value="state" className="shrink-0 px-2 text-xs">
              State ({stateTimeline.length})
            </TabsTrigger>
            <TabsTrigger value="trace" className="shrink-0 px-2 text-xs">
              Trace ({spans.length})
            </TabsTrigger>
            <TabsTrigger value="logs" className="shrink-0 px-2 text-xs">
              Logs ({logs.length})
            </TabsTrigger>
            <TabsTrigger value="raw" className="shrink-0 px-2 text-xs">
              Raw
            </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="overview" className={cn(DEBUG_TAB_SCROLL, "space-y-4")}>
            {isRunning && !lastDebug && activeRequestId && (
              <Section title="Request">
                <MetaRow label="Request ID" value={activeRequestId} />
                <p className="text-xs text-muted-foreground">
                  Run in progress — full debug will appear when complete. Stream
                  tab shows live agent events.
                </p>
              </Section>
            )}

            {lastDebug && (
              <>
            <Section title="Request">
              {requestId && <MetaRow label="Request ID" value={requestId} />}
              {correlationId && (
                <MetaRow label="Correlation ID" value={correlationId} />
              )}
              {trace && (
                <MetaRow
                  label="Total duration"
                  value={`${String(trace.durationMs ?? 0)} ms`}
                />
              )}
            </Section>

            {agent && (
              <Section title="Agent">
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Provider" value={String(agent.provider ?? "—")} />
                  <StatCard label="Model" value={String(agent.model ?? "—")} />
                  <StatCard
                    label="Read-only"
                    value={agent.readOnly ? "Yes" : "No"}
                  />
                  <StatCard
                    label="Max retries"
                    value={String(agent.maxValidationRetries ?? "—")}
                  />
                </div>
              </Section>
            )}

            {database && (
              <Section title="Database">
                <div className="rounded-md border border-border bg-background p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        database.type === "postgres" ? "postgres" : "mysql"
                      }
                    >
                      {String(database.type)}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {String(database.name ?? "—")}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {String(database.host ?? "—")}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {database.metadataSource !== undefined && (
                      <StatCard
                        label="Schema source"
                        value={String(database.metadataSource)}
                      />
                    )}
                    {database.schemaTableCount !== undefined && (
                      <StatCard
                        label="Stored tables"
                        value={String(database.schemaTableCount)}
                      />
                    )}
                    {database.hasBusinessContext !== undefined && (
                      <StatCard
                        label="Business context"
                        value={database.hasBusinessContext ? "Set" : "None"}
                      />
                    )}
                  </div>
                </div>
              </Section>
            )}

            {input && (
              <Section title="Input">
                <div className="space-y-2">
                  <MetaRow label="Query" value={String(input.query ?? "—")} />
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard
                      label="Dry run"
                      value={input.dryRun ? "Yes" : "No"}
                    />
                    <StatCard
                      label="Prior messages"
                      value={String(input.priorMessageCount ?? 0)}
                    />
                  </div>
                </div>
              </Section>
            )}

            {output && (
              <Section title="Output">
                <div className="space-y-2">
                  {typeof output.markdownResponse === "string" && (
                    <div className="rounded-md border border-border bg-background p-2.5">
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Markdown response
                      </p>
                      <MarkdownContent
                        content={output.markdownResponse}
                        compact
                        className="max-h-64 overflow-y-auto"
                      />
                    </div>
                  )}
                  {typeof output.generatedSql === "string" && output.generatedSql && (
                    <div className="rounded-md border border-border bg-background p-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Generated SQL
                      </p>
                      <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-foreground">
                        {output.generatedSql}
                      </pre>
                    </div>
                  )}
                  {executionResult && (
                    <div className="grid grid-cols-2 gap-2">
                      <StatCard
                        label="Rows returned"
                        value={String(executionResult.rowCount ?? 0)}
                      />
                      <StatCard
                        label="Columns"
                        value={
                          Array.isArray(executionResult.columns)
                            ? executionResult.columns.join(", ")
                            : "—"
                        }
                      />
                    </div>
                  )}
                </div>
              </Section>
            )}

            {workflow && (
              <Section title="Workflow">
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard
                      label="Domain specific"
                      value={
                        workflow.isDomainSpecific === undefined
                          ? "—"
                          : workflow.isDomainSpecific
                            ? "Yes"
                            : "No"
                      }
                    />
                    <StatCard
                      label="Requires SQL"
                      value={
                        workflow.requiresSql === undefined
                          ? "—"
                          : workflow.requiresSql
                            ? "Yes"
                            : "No"
                      }
                    />
                    <StatCard
                      label="Validation"
                      value={
                        workflow.validationPassed === undefined
                          ? "—"
                          : workflow.validationPassed
                            ? "Passed"
                            : "Failed"
                      }
                    />
                    <StatCard
                      label="SQL parser"
                      value={
                        workflow.sqlParserPassed === undefined
                          ? "—"
                          : workflow.sqlParserPassed
                            ? "Passed"
                            : "Failed"
                      }
                    />
                    <StatCard
                      label="Answer verified"
                      value={
                        workflow.answerSatisfied === undefined
                          ? "—"
                          : workflow.answerSatisfied
                            ? "Yes"
                            : "No"
                      }
                    />
                  </div>
                  {typeof workflow.sqlParserError === "string" &&
                    workflow.sqlParserError.length > 0 && (
                      <MetaRow
                        label="SQL parser error"
                        value={workflow.sqlParserError}
                      />
                    )}
                  {sqlParserStats && (
                    <div className="rounded-md border border-border bg-background p-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        SQL parser stats
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <StatCard
                          label="Dialect"
                          value={String(sqlParserStats.dialect ?? "—")}
                        />
                        <StatCard
                          label="Statement"
                          value={String(sqlParserStats.statementType ?? "—")}
                        />
                        <StatCard
                          label="Tables"
                          value={String(sqlParserStats.tableCount ?? 0)}
                        />
                        <StatCard
                          label="Columns"
                          value={String(sqlParserStats.columnCount ?? 0)}
                        />
                      </div>
                      {Array.isArray(sqlParserStats.tables) &&
                        sqlParserStats.tables.length > 0 && (
                          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                            {sqlParserStats.tables.map(String).join(", ")}
                          </p>
                        )}
                    </div>
                  )}
                  {typeof workflow.plannerReason === "string" && (
                    <MetaRow label="Planner reason" value={workflow.plannerReason} />
                  )}
                  {graph && graph.path.length > 0 && (
                    <div className="rounded-md border border-border bg-background p-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Path
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-foreground">
                        {graph.path.join(" → ")}
                      </p>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {totals && (
              <Section title="Run metrics">
                <div className="grid grid-cols-2 gap-2">
                  <StatCard
                    label="LLM calls"
                    value={String(totals.llmCallCount ?? 0)}
                  />
                  <StatCard
                    label="Structured LLM"
                    value={String(totals.structuredLlmCallCount ?? 0)}
                  />
                  <StatCard
                    label="Prompt tokens"
                    value={String(totals.totalPromptTokens ?? 0)}
                  />
                  <StatCard
                    label="Completion tokens"
                    value={String(totals.totalCompletionTokens ?? 0)}
                  />
                  {totals.totalTokens !== undefined && (
                    <StatCard
                      label="Total tokens"
                      value={String(totals.totalTokens)}
                    />
                  )}
                  <StatCard
                    label="LLM latency"
                    value={`${String(totals.totalLlmLatencyMs ?? 0)} ms`}
                  />
                  <StatCard
                    label="Validation failures"
                    value={String(totals.validationFailureCount ?? 0)}
                  />
                  {totals.dbConnectMs !== undefined && (
                    <StatCard
                      label="DB connect"
                      value={`${String(totals.dbConnectMs)} ms`}
                    />
                  )}
                  {totals.schemaFetchMs !== undefined && (
                    <StatCard
                      label="Schema fetch"
                      value={`${String(totals.schemaFetchMs)} ms`}
                    />
                  )}
                  {totals.tablesInSchema !== undefined && (
                    <StatCard
                      label="Tables in schema"
                      value={String(totals.tablesInSchema)}
                    />
                  )}
                  {totals.queryExecutionMs !== undefined && (
                    <StatCard
                      label="Query execution"
                      value={`${String(totals.queryExecutionMs)} ms`}
                    />
                  )}
                  {totals.rowsReturned !== undefined && (
                    <StatCard
                      label="Rows from DB"
                      value={String(totals.rowsReturned)}
                    />
                  )}
                </div>
              </Section>
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="stream" className={DEBUG_TAB_PANEL}>
            <StreamEventsView events={streamEvents} className="h-full" />
          </TabsContent>

          <TabsContent value="metrics" className={cn(DEBUG_TAB_SCROLL, "space-y-4")}>
            {!lastDebug ? (
              <p className="text-xs text-muted-foreground">
                Metrics available after the run completes.
              </p>
            ) : (
              <>
            {verificationAttempts.length > 0 && (
              <Section title="Verification attempts">
                <div className="space-y-1.5">
                  {verificationAttempts.map((v, i) => (
                    <div
                      key={`verify-${i}`}
                      className="rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>Attempt {String(v.attempt)}</span>
                        <Badge
                          variant={v.answerSatisfied ? "success" : "destructive"}
                          className="normal-case"
                        >
                          {v.answerSatisfied ? "satisfied" : "failed"}
                        </Badge>
                      </div>
                      {typeof v.reason === "string" && v.reason && (
                        <p className="mt-1 text-muted-foreground">{v.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {validationAttempts.length > 0 && (
              <Section title="Validation attempts">
                <div className="space-y-1.5">
                  {validationAttempts.map((v, i) => (
                    <div
                      key={`val-${i}`}
                      className="rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          Attempt {String(v.attempt)}
                          <Badge
                            variant={validationSourceVariant(v.source)}
                            className="normal-case"
                          >
                            {validationSourceLabel(v.source)}
                          </Badge>
                        </span>
                        <Badge
                          variant={v.validationPassed ? "success" : "destructive"}
                          className="normal-case"
                        >
                          {v.validationPassed ? "passed" : "failed"}
                        </Badge>
                      </div>
                      {v.errorCount !== undefined && Number(v.errorCount) > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          {String(v.errorCount)} error
                          {Number(v.errorCount) === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {llmCalls.length > 0 && (
              <Section title="LLM calls">
                <div className="space-y-1.5">
                  {llmCalls.map((call, i) => (
                    <div
                      key={`llm-${i}`}
                      className="rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{String(call.node ?? call.event)}</span>
                        <span className="text-muted-foreground">
                          {String(call.latencyMs ?? 0)} ms
                        </span>
                      </div>
                      {call.totalTokens !== undefined && (
                        <p className="mt-0.5 text-muted-foreground">
                          tokens: {String(call.totalTokens)} (prompt{" "}
                          {String(call.promptTokens ?? 0)} / completion{" "}
                          {String(call.completionTokens ?? 0)})
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {dbOps.length > 0 && (
              <Section title="Database operations">
                <div className="space-y-1.5">
                  {dbOps.map((op, i) => (
                    <div
                      key={`db-${i}`}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                    >
                      <span className="font-medium">{String(op.event)}</span>
                      <span className="text-muted-foreground">
                        {op.durationMs !== undefined && `${String(op.durationMs)} ms`}
                        {op.tableCount !== undefined && ` · ${String(op.tableCount)} tables`}
                        {op.rowCount !== undefined && ` · ${String(op.rowCount)} rows`}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
              </>
            )}
          </TabsContent>

          <TabsContent value="graph" className={DEBUG_TAB_SCROLL}>
            {!lastDebug ? (
              <p className="text-xs text-muted-foreground">
                Graph available after the run completes.
              </p>
            ) : graph ? (
              <WorkflowGraphView graph={graph} />
            ) : (
              <EmptyState
                icon={Bug}
                title="No graph data"
                description="Send a new message to capture the workflow graph with node state. Older messages may not include graph data."
                className="py-8"
              />
            )}
          </TabsContent>

          <TabsContent value="state" className={DEBUG_TAB_PANEL}>
            {!lastDebug ? (
              <p className="p-2 text-xs text-muted-foreground">
                State timeline available after the run completes.
              </p>
            ) : (
              <StateNavView steps={stateTimeline} />
            )}
          </TabsContent>

          <TabsContent value="trace" className={DEBUG_TAB_SCROLL}>
            {!lastDebug ? (
              <p className="text-xs text-muted-foreground">
                Trace spans available after the run completes.
              </p>
            ) : spans.length === 0 ? (
              <p className="text-xs text-muted-foreground">No node spans recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {spans.map((span) => (
                  <div
                    key={String(span.nodeName)}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                  >
                    <span className="font-medium text-foreground">
                      {String(span.nodeName)}
                    </span>
                    <span className="text-muted-foreground">
                      {String(span.durationMs)} ms
                      {!span.success && " · failed"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className={DEBUG_TAB_SCROLL}>
            {!lastDebug ? (
              <p className="text-xs text-muted-foreground">
                Logs available after the run completes.
              </p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No structured logs captured.</p>
            ) : (
              <div className="space-y-1.5">
                {logs.map((log, index) => {
                  const level = String(log.level ?? "info");
                  const message =
                    typeof log.message === "string"
                      ? log.message
                      : typeof log.event === "string"
                        ? log.event
                        : JSON.stringify(log);

                  return (
                    <div
                      key={`${level}-${index}`}
                      className="rounded-md border border-border bg-background px-2.5 py-2"
                    >
                      <div className="flex items-start gap-2">
                        <LogLevelBadge level={level} />
                        <p className="min-w-0 flex-1 wrap-break-word font-mono text-[11px] leading-relaxed text-foreground">
                          {message}
                        </p>
                      </div>
                      {typeof log.node === "string" && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          node: {log.node}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="raw" className={DEBUG_TAB_PANEL}>
            <pre className="h-full overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] leading-relaxed text-foreground">
              {JSON.stringify(lastDebug ?? { streamEvents }, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
