import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FolderInput, RotateCcw, Save } from "lucide-react";
import type { QueryAttempt, QueryRunResult, WorkflowTestCompletePayload, WorkflowTestGroupRecord } from "../../api";
import { isResumableWorkflowRun } from "../../api";
import { importWorkflowTestFailures } from "../../api";
import { useWorkflowTestRunner } from "../../context/WorkflowTestRunnerContext";
import { providerLabel } from "../../lib/llmProviders";
import {
  categoryTypeLabel,
  formatOutcomeLabel,
  isFatalAbortMessage,
  outcomesMatch,
} from "../../lib/workflowTestReportHelpers";
import { cn } from "../../lib/cn";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
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
import { WorkflowTestMetricsDashboard } from "./WorkflowTestMetricsDashboard";

interface Props {
  report: WorkflowTestCompletePayload;
  onLoadFailuresInSetup?: () => void;
  onFailuresImported?: (result: {
    testId: string;
    testName?: string;
    groups: WorkflowTestGroupRecord[];
  }) => void;
}

type StatusFilter = "all" | "pass" | "fail" | "error" | "planner_skip";

const RESULTS_PAGE_SIZE = 50;

function expectedOf(result: QueryRunResult): string | undefined {
  return result.expectedOutcome ?? result.expectedResult;
}

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
          { label: "Category", value: categoryTypeLabel(result.categoryType) },
          {
            label: "Expected outcome",
            value: formatOutcomeLabel(expectedOf(result)),
          },
          {
            label: "Actual outcome",
            value: formatOutcomeLabel(result.actualOutcome),
          },
          {
            label: "History mode",
            value: result.history ?? "—",
          },
          ...(result.stopOnFailure !== undefined
            ? [
                {
                  label: "Stop on failure",
                  value: result.stopOnFailure ? "yes" : "no",
                },
              ]
            : []),
          ...(result.timeoutMs !== undefined
            ? [{ label: "Timeout", value: `${result.timeoutMs} ms` }]
            : []),
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

export function WorkflowTestReport({
  report,
  onLoadFailuresInSetup,
  onFailuresImported,
}: Props) {
  const { rerunFailuresInReport, resumeFromRun, running, notifySavedGroupsChanged } =
    useWorkflowTestRunner();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveGroupName, setSaveGroupName] = useState(
    () => `${report.testName} — Failed queries`,
  );

  const { summary } = report;
  const failureCount = summary.failed + summary.errors;
  const canImport = failureCount > 0 && Boolean(report.testId && report.runId);
  const canLoadFailuresInSetup =
    failureCount > 0 && Boolean(onLoadFailuresInSetup && report.runId);
  const canResume = isResumableWorkflowRun(report);
  const remainingCount = Math.max(
    0,
    (summary.plannedQueries ?? report.results.length) - report.results.length,
  );

  const fatalAbortMessage = useMemo(() => {
    for (const result of report.results) {
      if (isFatalAbortMessage(result.errorMessage)) {
        return result.errorMessage!;
      }
    }
    return null;
  }, [report.results]);

  const categoryOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const result of report.results) {
      keys.add(result.categoryType ?? "STANDARD");
    }
    if (summary.byCategory) {
      for (const key of Object.keys(summary.byCategory)) keys.add(key);
    }
    return [...keys].sort();
  }, [report.results, summary.byCategory]);

  const categoryRows = useMemo(() => {
    if (summary.byCategory && Object.keys(summary.byCategory).length > 0) {
      return Object.entries(summary.byCategory);
    }
    const map = new Map<
      string,
      { total: number; passed: number; failed: number; errors: number; plannerSkipped: number }
    >();
    for (const result of report.results) {
      const key = result.categoryType ?? "STANDARD";
      const stats = map.get(key) ?? {
        total: 0,
        passed: 0,
        failed: 0,
        errors: 0,
        plannerSkipped: 0,
      };
      stats.total += 1;
      if (result.status === "pass") stats.passed += 1;
      else if (result.status === "error") stats.errors += 1;
      else if (result.status === "planner_skip") stats.plannerSkipped += 1;
      else stats.failed += 1;
      map.set(key, stats);
    }
    return [...map.entries()];
  }, [report.results, summary.byCategory]);

  const outcomeMatched =
    summary.outcomeMatched ??
    report.results.filter(
      (r) =>
        r.status !== "error" &&
        expectedOf(r) &&
        outcomesMatch(expectedOf(r), r.actualOutcome),
    ).length;
  const outcomeMismatched =
    summary.outcomeMismatched ??
    report.results.filter(
      (r) =>
        r.status !== "error" &&
        expectedOf(r) &&
        !outcomesMatch(expectedOf(r), r.actualOutcome),
    ).length;

  useEffect(() => {
    setImportNotice(null);
  }, [report.testId, report.runId]);

  async function handleSaveFailures() {
    if (!report.testId || !report.runId) return;
    setImporting(true);
    setImportNotice(null);
    try {
      const result = await importWorkflowTestFailures(
        report.testId,
        report.runId,
        saveGroupName,
      );
      const skippedText =
        result.skipped > 0 ? `, skipped ${result.skipped} duplicate(s)` : "";
      const action = result.created ? "Created" : "Updated";
      setImportNotice(
        `${action} test "${result.testName}" with ${result.added} quer${result.added === 1 ? "y" : "ies"} across ${result.targetGroupName}${skippedText}. Find it under Tests.`,
      );
      onFailuresImported?.({
        testId: result.testId,
        testName: result.testName,
        groups: result.groups,
      });
      notifySavedGroupsChanged();
      setSaveDialogOpen(false);
    } catch (err) {
      setImportNotice(
        err instanceof Error ? err.message : "Failed to save failures as a new test.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleResume() {
    if (!report.runId) return;
    await resumeFromRun(report.runId, {
      testName: report.testName,
      dryRun: report.dryRun,
      delayMs: report.delayMs ?? 0,
    });
  }

  async function handleRerunInReport() {
    if (!report.runId) return;
    await rerunFailuresInReport(report.runId, {
      testName: report.testName,
      dryRun: report.dryRun,
      delayMs: report.delayMs ?? 0,
    });
  }

  const filtered = useMemo(() => {
    return report.results.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (
        categoryFilter !== "all" &&
        (r.categoryType ?? "STANDARD") !== categoryFilter
      ) {
        return false;
      }
      if (mismatchOnly) {
        const expected = expectedOf(r);
        if (!expected || outcomesMatch(expected, r.actualOutcome)) return false;
      }
      return true;
    });
  }, [filter, categoryFilter, mismatchOnly, report.results]);

  useEffect(() => {
    setPage(0);
    setExpandedKey(null);
  }, [filter, categoryFilter, mismatchOnly, report.runId]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / RESULTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () =>
      filtered.slice(
        safePage * RESULTS_PAGE_SIZE,
        safePage * RESULTS_PAGE_SIZE + RESULTS_PAGE_SIZE,
      ),
    [filtered, safePage],
  );

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
            {report.agent && (
              <>
                {" "}
                · {report.agent.name} ({providerLabel(report.agent.llmProvider)}
                {report.agent.modelName ? ` · ${report.agent.modelName}` : ""})
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canResume && (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={running}
              onClick={() => void handleResume()}
            >
              <RotateCcw className="h-4 w-4" />
              Resume ({remainingCount} remaining)
            </Button>
          )}
          {canLoadFailuresInSetup && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={onLoadFailuresInSetup}
            >
              <FolderInput className="h-4 w-4" />
              Load failures in setup
            </Button>
          )}
          {canImport && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => {
                setSaveGroupName(`${report.testName} — Failed queries`);
                setSaveDialogOpen(true);
              }}
            >
              <Save className="h-4 w-4" />
              Save failures as new test
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
          <Button type="button" variant="secondary" size="sm" onClick={exportJson}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save failures as new test</DialogTitle>
            <DialogDescription>
              Creates a separate workflow test in Tests with the failed queries kept
              in their original groups and category types. You can load it from Tests
              later and run with a different agent or settings. Saving again with the
              same name appends new failures to that test.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="save-failures-group-name">New test name</Label>
            <Input
              id="save-failures-group-name"
              className="mt-1"
              value={saveGroupName}
              onChange={(e) => setSaveGroupName(e.target.value)}
              placeholder={`${report.testName} — Failed queries`}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSaveDialogOpen(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={importing}
              onClick={() => void handleSaveFailures()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fatalAbortMessage && (
        <Alert variant="error">
          Run aborted due to a fatal provider error: {fatalAbortMessage}
        </Alert>
      )}

      {canResume && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This run stopped early with {report.results.length} of{" "}
          {summary.plannedQueries ?? report.results.length} queries completed.
          Resume to continue from where it left off.
        </p>
      )}

      {importNotice && (
        <p className="text-sm text-muted-foreground">{importNotice}</p>
      )}

      <WorkflowTestMetricsDashboard report={report} />

      <InspectSection title="Run summary">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{summary.passed} passed</Badge>
            <Badge variant="destructive">{summary.failed} failed</Badge>
            <Badge variant="destructive">{summary.errors} errors</Badge>
            <Badge variant="outline">{summary.plannerSkipped} planner skip</Badge>
            <Badge variant="info">{summary.total} total</Badge>
            <Badge variant="success">{outcomeMatched} outcome matched</Badge>
            <Badge variant="destructive">{outcomeMismatched} outcome mismatched</Badge>
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

          {categoryRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">By category</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Passed</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Planner skip</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryRows.map(([name, stats]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium">
                        {categoryTypeLabel(name)}
                      </TableCell>
                      <TableCell>{stats.total}</TableCell>
                      <TableCell>{stats.passed}</TableCell>
                      <TableCell>{stats.failed}</TableCell>
                      <TableCell>{stats.errors}</TableCell>
                      <TableCell>{stats.plannerSkipped}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {groupRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">By group</p>
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
            </div>
          )}
        </div>
      </InspectSection>

      <div className="flex flex-wrap items-center gap-2">
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
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categoryOptions.map((cat) => (
            <option key={cat} value={cat}>
              {categoryTypeLabel(cat)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-input"
            checked={mismatchOnly}
            onChange={(e) => setMismatchOnly(e.target.checked)}
          />
          Outcome mismatches only
        </label>
        <span className="text-xs text-muted-foreground">
          {filtered.length} shown
          {filtered.length !== report.results.length
            ? ` of ${report.results.length}`
            : ""}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Group</TableHead>
            <TableHead>Query</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Actual</TableHead>
            <TableHead>History</TableHead>
            <TableHead>Phase</TableHead>
            <TableHead>Failed node</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Tokens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((result, index) => {
            const absoluteIndex = safePage * RESULTS_PAGE_SIZE + index;
            const key = rowKey(result, absoluteIndex);
            const expanded = expandedKey === key;
            return (
              <ResultTableRows
                key={key}
                result={result}
                expanded={expanded}
                onToggleExpand={() =>
                  setExpandedKey(expanded ? null : key)
                }
              />
            );
          })}
        </TableBody>
      </Table>

      {filtered.length === 0 && (
        <p className={cn("py-6 text-center text-sm text-muted-foreground")}>
          No results match this filter.
        </p>
      )}

      {filtered.length > RESULTS_PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Page {safePage + 1} of {pageCount} · {RESULTS_PAGE_SIZE} per page
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={safePage <= 0}
              onClick={() => {
                setExpandedKey(null);
                setPage((p) => Math.max(0, p - 1));
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={safePage >= pageCount - 1}
              onClick={() => {
                setExpandedKey(null);
                setPage((p) => Math.min(pageCount - 1, p + 1));
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ResultTableRows = memo(function ResultTableRows({
  result,
  expanded,
  onToggleExpand,
}: {
  result: QueryRunResult;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const expected = expectedOf(result);
  const matched = outcomesMatch(expected, result.actualOutcome);

  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <button
            type="button"
            onClick={onToggleExpand}
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
          <Badge variant="outline" className="normal-case">
            {categoryTypeLabel(result.categoryType)}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant={statusVariant(result.status)} className="normal-case">
            {statusLabel(result.status)}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatOutcomeLabel(expected)}
        </TableCell>
        <TableCell
          className={cn(
            "text-xs",
            expected && result.actualOutcome && !matched
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {formatOutcomeLabel(result.actualOutcome)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {result.history ?? "—"}
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
          <TableCell colSpan={13}>
            <ResultInspector result={result} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
});
