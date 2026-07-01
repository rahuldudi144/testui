import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, RotateCcw, Save } from "lucide-react";
import type { QueryAttempt, QueryRunResult, WorkflowTestCompletePayload } from "../../api";
import { getWorkflowTest, importWorkflowTestFailures } from "../../api";
import { useWorkflowTestRunner } from "../../context/WorkflowTestRunnerContext";
import { getFailuresGroup } from "../../lib/workflowTestGroups";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";
import {
  InspectCodeBlock,
  InspectMetaGrid,
  InspectSection,
  InspectStateTable,
  WorkflowPathPills,
} from "./InspectBlocks";

interface Props {
  report: WorkflowTestCompletePayload;
}

type StatusFilter = "all" | "pass" | "fail" | "error" | "planner_skip";

function statusVariant(
  status: QueryRunResult["status"],
): "success" | "destructive" | "outline" | "info" {
  if (status === "pass") return "success";
  if (status === "fail") return "destructive";
  if (status === "error") return "destructive";
  return "outline";
}

function statusLabel(status: QueryRunResult["status"]): string {
  if (status === "planner_skip") return "planner skip";
  return status;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  return value.toLocaleString();
}

function AttemptHistory({ attempts }: { attempts: QueryAttempt[] }) {
  return (
    <InspectSection title="Rerun history">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ran at</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Prompt</TableHead>
            <TableHead>Completion</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>LLM calls</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((attempt) => (
            <TableRow key={attempt.attemptNumber}>
              <TableCell>{attempt.attemptNumber}</TableCell>
              <TableCell className="capitalize">{attempt.kind}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(attempt.status)} className="normal-case">
                  {statusLabel(attempt.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(attempt.ranAt).toLocaleString()}
              </TableCell>
              <TableCell className="tabular-nums text-xs">{attempt.durationMs} ms</TableCell>
              <TableCell className="tabular-nums text-xs">
                {formatTokens(attempt.promptTokens)}
              </TableCell>
              <TableCell className="tabular-nums text-xs">
                {formatTokens(attempt.completionTokens)}
              </TableCell>
              <TableCell className="tabular-nums text-xs">
                {formatTokens(attempt.totalTokens)}
              </TableCell>
              <TableCell className="tabular-nums text-xs">
                {attempt.llmCalls.length}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {attempts.some((attempt) => attempt.llmCalls.length > 0) && (
        <div className="mt-4 space-y-3">
          {attempts.map((attempt) =>
            attempt.llmCalls.length > 0 ? (
              <div key={`llm-${attempt.attemptNumber}`}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Attempt {attempt.attemptNumber} — per-node tokens
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Node</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead>Completion</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attempt.llmCalls.map((call, index) => (
                      <TableRow key={`${attempt.attemptNumber}-${call.node ?? index}`}>
                        <TableCell className="font-mono text-xs">
                          {call.node ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatTokens(call.promptTokens)}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatTokens(call.completionTokens)}
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">
                          {formatTokens(call.totalTokens)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null,
          )}
        </div>
      )}
    </InspectSection>
  );
}

function ResultInspector({ result }: { result: QueryRunResult }) {
  const attempts =
    result.attempts ??
    [
      {
        attemptNumber: 1,
        kind: "initial" as const,
        ranAt: new Date(0).toISOString(),
        status: result.status,
        durationMs: result.durationMs,
        requestId: result.requestId,
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        totalTokens: result.totalTokens ?? 0,
        llmCalls: [],
        failurePhase: result.failurePhase,
        failedNode: result.failedNode,
        failureState: result.failureState,
        failedNodeResponse: result.failedNodeResponse,
        generatedSql: result.generatedSql,
        markdownPreview: result.markdownPreview,
        markdownResponse: result.markdownResponse,
        workflowPath: result.workflowPath,
        workflowStatus: result.workflowStatus,
        errorMessage: result.errorMessage,
      },
    ];

  return (
    <div className="space-y-3 py-2">
      <InspectMetaGrid
        items={[
          { label: "Status", value: statusLabel(result.status) },
          {
            label: "Failure phase",
            value: result.failurePhase === "none" ? "—" : result.failurePhase,
          },
          { label: "Failed node", value: result.failedNode ?? "—" },
          { label: "Duration", value: `${result.durationMs} ms` },
          { label: "Attempts", value: String(result.executionCount ?? attempts.length) },
          {
            label: "Total tokens",
            value: formatTokens(result.totalTokens),
          },
          { label: "Workflow status", value: result.workflowStatus ?? "—" },
          { label: "Request ID", value: result.requestId ?? "—" },
        ]}
      />

      <AttemptHistory attempts={attempts} />

      <InspectSection title="Query">
        <InspectCodeBlock value={result.query} />
      </InspectSection>

      {result.generatedSql && (
        <InspectSection title="Generated SQL">
          <InspectCodeBlock value={result.generatedSql} language="sql" />
        </InspectSection>
      )}

      {result.errorMessage && (
        <InspectSection title="Agent error" variant="destructive">
          <InspectCodeBlock value={result.errorMessage} />
        </InspectSection>
      )}

      {result.failedNodeResponse && (
        <InspectSection
          title={`Failed node response — ${result.failedNodeResponse.label} (${result.failedNodeResponse.node})`}
          variant="destructive"
        >
          {result.failedNodeResponse.text ? (
            <InspectCodeBlock value={result.failedNodeResponse.text} />
          ) : (
            <p className="mb-3 text-xs text-muted-foreground">
              No text response captured for this node.
            </p>
          )}
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Node state
          </p>
          <InspectStateTable state={result.failedNodeResponse.state} />
        </InspectSection>
      )}

      {result.markdownResponse && (
        <InspectSection title="Final agent response">
          <InspectCodeBlock value={result.markdownResponse} />
        </InspectSection>
      )}

      {result.workflowPath && result.workflowPath.length > 0 && (
        <InspectSection title="Workflow path">
          <WorkflowPathPills path={result.workflowPath} />
        </InspectSection>
      )}

      {result.failureState &&
        Object.keys(result.failureState).length > 0 &&
        !result.failedNodeResponse && (
          <InspectSection title="Failure state">
            <InspectStateTable state={result.failureState} />
          </InspectSection>
        )}
    </div>
  );
}

export function WorkflowTestReport({ report }: Props) {
  const { runGroup, rerunFailuresInReport, running } = useWorkflowTestRunner();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [failuresGroupId, setFailuresGroupId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const { summary } = report;
  const failureCount = summary.failed + summary.errors;
  const canImport = failureCount > 0 && Boolean(report.testId && report.runId);

  useEffect(() => {
    if (!report.testId) return;
    let cancelled = false;
    void getWorkflowTest(report.testId)
      .then((test) => {
        if (cancelled) return;
        const failures = getFailuresGroup(test.groups);
        if (failures && failures.queries.length > 0) {
          setFailuresGroupId(failures.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [report.testId, report.runId]);

  async function handleSaveFailures() {
    if (!report.testId || !report.runId) return;
    setImporting(true);
    setImportNotice(null);
    try {
      const result = await importWorkflowTestFailures(report.testId, report.runId);
      const failures = getFailuresGroup(result.groups);
      setFailuresGroupId(failures?.id ?? null);
      const skippedText =
        result.skipped > 0 ? `, skipped ${result.skipped} duplicate(s)` : "";
      setImportNotice(`Added ${result.added} quer${result.added === 1 ? "y" : "ies"} to failures group${skippedText}.`);
    } catch (err) {
      setImportNotice(
        err instanceof Error ? err.message : "Failed to save failures to group.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleRerunInReport() {
    if (!report.runId) return;
    await rerunFailuresInReport(report.runId, {
      testName: report.testName,
      dryRun: report.dryRun,
      delayMs: report.delayMs ?? 0,
    });
  }

  async function handleRunFailures() {
    if (!report.testId || !failuresGroupId) return;
    await runGroup(report.testId, failuresGroupId, {
      testName: report.testName,
      dryRun: report.dryRun,
      delayMs: report.delayMs ?? 0,
    });
  }

  const filtered = useMemo(() => {
    if (filter === "all") return report.results;
    return report.results.filter((r) => r.status === filter);
  }, [filter, report.results]);

  function rowKey(result: QueryRunResult, index: number): string {
    return `${result.groupName}-${index}-${result.query.slice(0, 24)}`;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.testName.replace(/\s+/g, "-").toLowerCase()}-workflow-test.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const groupRows = Object.entries(summary.byGroup);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{report.testName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date(report.ranAt).toLocaleString()} · {report.database.name} (
            {report.database.dbType}) · {report.dryRun ? "dry run" : "execute"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImport && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={importing}
              disabled={running}
              onClick={() => void handleSaveFailures()}
            >
              <Save className="h-4 w-4" />
              Save failures to group
            </Button>
          )}
          {canImport && report.runId && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => void handleRerunInReport()}
            >
              <RotateCcw className="h-4 w-4" />
              Rerun failures in this report
            </Button>
          )}
          {failuresGroupId && (
            <Button
              type="button"
              size="sm"
              disabled={running}
              onClick={() => void handleRunFailures()}
            >
              <RotateCcw className="h-4 w-4" />
              Run failures only
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={exportJson}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </div>

      {importNotice && (
        <p className="text-sm text-muted-foreground">{importNotice}</p>
      )}

      <InspectSection title="Run summary">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{summary.passed} passed</Badge>
            <Badge variant="destructive">{summary.failed} failed</Badge>
            <Badge variant="destructive">{summary.errors} errors</Badge>
            <Badge variant="outline">{summary.plannerSkipped} planner skip</Badge>
            <Badge variant="info">{summary.total} total</Badge>
            {summary.executionCount !== undefined && (
              <Badge variant="outline">{summary.executionCount} executions</Badge>
            )}
            {summary.totalTokens !== undefined && (
              <Badge variant="outline">
                {formatTokens(summary.totalTokens)} tokens
              </Badge>
            )}
          </div>

          {Object.keys(summary.byPhase).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.byPhase).map(([phase, count]) => (
                <Badge key={phase} variant="outline" className="normal-case">
                  {phase}: {count}
                </Badge>
              ))}
            </div>
          )}

          {groupRows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Passed</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Planner skip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupRows.map(([name, stats]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell>{stats.total}</TableCell>
                    <TableCell>{stats.passed}</TableCell>
                    <TableCell>{stats.failed}</TableCell>
                    <TableCell>{stats.errors}</TableCell>
                    <TableCell>{stats.plannerSkipped}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </InspectSection>

      <div className="flex flex-wrap gap-2">
        {(["all", "pass", "fail", "error", "planner_skip"] as StatusFilter[]).map(
          (value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "secondary"}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : statusLabel(value as QueryRunResult["status"])}
            </Button>
          ),
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Group</TableHead>
            <TableHead>Query</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Failed node</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Tokens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((result, index) => {
            const key = rowKey(result, index);
            const expanded = expandedKey === key;

            return (
              <Fragment key={key}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : key)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted focus-ring"
                      aria-label={expanded ? "Collapse details" : "Expand details"}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{result.groupName}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={result.query}>
                    {result.query}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(result.status)} className="normal-case">
                      {statusLabel(result.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {result.failurePhase === "none" ? "—" : result.failurePhase}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {result.failedNode ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {result.durationMs} ms
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {result.executionCount ?? result.attempts?.length ?? 1}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {formatTokens(result.totalTokens)}
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={9}>
                      <ResultInspector result={result} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>

      {filtered.length === 0 && (
        <p className={cn("py-6 text-center text-sm text-muted-foreground")}>
          No results match this filter.
        </p>
      )}
    </div>
  );
}
