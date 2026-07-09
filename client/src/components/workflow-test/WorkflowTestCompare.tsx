import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  getWorkflowTest,
  getWorkflowTestRun,
  listWorkflowTests,
  type SavedWorkflowTest,
  type WorkflowTestCompletePayload,
} from "../../api";
import { providerLabel } from "../../lib/llmProviders";
import {
  alignCompareResults,
  countOverlappingQueries,
  finalAnswerText,
} from "../../lib/workflowTestCompare";
import { cn } from "../../lib/cn";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Label } from "../ui/Label";
import { MarkdownContent } from "../ui/MarkdownContent";
import { InspectCodeBlock, InspectSection } from "./InspectBlocks";
import {
  buildCompareMetrics,
  WorkflowTestMetricsDashboard,
} from "./WorkflowTestMetricsDashboard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";

interface Props {
  refreshToken?: number;
  onError: (message: string) => void;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "—";
  return value.toLocaleString();
}

function statusVariant(
  status: string | undefined,
): "success" | "destructive" | "outline" | "info" {
  if (status === "pass") return "success";
  if (status === "fail" || status === "error") return "destructive";
  if (status === "planner_skip") return "outline";
  return "info";
}

function statusLabel(status: string | undefined): string {
  if (!status) return "—";
  if (status === "planner_skip") return "planner skip";
  return status;
}

function agentLine(agent?: { name: string; llmProvider: string | null; modelName: string | null }): string {
  if (!agent) return "No agent assigned";
  const provider = providerLabel(agent.llmProvider);
  const model = agent.modelName ?? "default model";
  return `${agent.name} (${provider} · ${model})`;
}

function SideSummary({
  label,
  report,
  test,
}: {
  label: string;
  report: WorkflowTestCompletePayload | null;
  test: SavedWorkflowTest | null;
}) {
  const agent = report?.agent ?? test?.agent ?? null;
  const summary = report?.summary;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">
        {test?.name ?? "—"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{agentLine(agent ?? undefined)}</p>
      {report && (
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(report.ranAt).toLocaleString()}
          {report.dryRun ? " · dry run" : ""}
        </p>
      )}
      {summary && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="success" className="normal-case">
            {summary.passed} passed
          </Badge>
          <Badge variant="destructive" className="normal-case">
            {summary.failed} failed
          </Badge>
          <Badge variant="destructive" className="normal-case">
            {summary.errors} errors
          </Badge>
          <Badge variant="outline" className="normal-case">
            {summary.plannerSkipped} planner skip
          </Badge>
          {summary.totalTokens !== undefined && (
            <Badge variant="outline" className="normal-case">
              {formatTokens(summary.totalTokens)} tokens
            </Badge>
          )}
          {summary.executionCount !== undefined && (
            <Badge variant="outline" className="normal-case">
              {summary.executionCount} executions
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowTestCompare({ refreshToken, onError }: Props) {
  const [tests, setTests] = useState<SavedWorkflowTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [testAId, setTestAId] = useState("");
  const [testBId, setTestBId] = useState("");
  const [runAId, setRunAId] = useState("");
  const [runBId, setRunBId] = useState("");
  const [detailA, setDetailA] = useState<Awaited<ReturnType<typeof getWorkflowTest>> | null>(null);
  const [detailB, setDetailB] = useState<Awaited<ReturnType<typeof getWorkflowTest>> | null>(null);
  const [reportA, setReportA] = useState<WorkflowTestCompletePayload | null>(null);
  const [reportB, setReportB] = useState<WorkflowTestCompletePayload | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [answerDiffsOnly, setAnswerDiffsOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listWorkflowTests();
      setTests(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load tests.");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const testA = useMemo(
    () => tests.find((test) => test.id === testAId) ?? null,
    [tests, testAId],
  );
  const testB = useMemo(
    () => tests.find((test) => test.id === testBId) ?? null,
    [tests, testBId],
  );

  const suitePairs = useMemo(() => {
    const bySuite = new Map<string, SavedWorkflowTest[]>();
    for (const test of tests) {
      const key = test.suiteKey ?? test.id;
      const group = bySuite.get(key) ?? [];
      group.push(test);
      bySuite.set(key, group);
    }
    return [...bySuite.values()].filter((group) => group.length >= 2);
  }, [tests]);

  useEffect(() => {
    if (!testAId) {
      setDetailA(null);
      return;
    }
    let cancelled = false;
    void getWorkflowTest(testAId)
      .then((detail) => {
        if (!cancelled) {
          setDetailA(detail);
          if (!runAId && detail.lastRun) {
            setRunAId(detail.lastRun.id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load test A.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [testAId, refreshToken, onError, runAId]);

  useEffect(() => {
    if (!testBId) {
      setDetailB(null);
      return;
    }
    let cancelled = false;
    void getWorkflowTest(testBId)
      .then((detail) => {
        if (!cancelled) {
          setDetailB(detail);
          if (!runBId && detail.lastRun) {
            setRunBId(detail.lastRun.id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load test B.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [testBId, refreshToken, onError, runBId]);

  useEffect(() => {
    if (!runAId) {
      setReportA(null);
      return;
    }
    let cancelled = false;
    void getWorkflowTestRun(runAId)
      .then((report) => {
        if (!cancelled) setReportA(report);
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load run A.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runAId, onError]);

  useEffect(() => {
    if (!runBId) {
      setReportB(null);
      return;
    }
    let cancelled = false;
    void getWorkflowTestRun(runBId)
      .then((report) => {
        if (!cancelled) setReportB(report);
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load run B.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runBId, onError]);

  const rows = useMemo(() => {
    if (!reportA || !reportB) return [];
    return alignCompareResults(reportA.results, reportB.results);
  }, [reportA, reportB]);

  const overlapCount = useMemo(() => {
    if (!reportA || !reportB) return 0;
    return countOverlappingQueries(reportA.results, reportB.results);
  }, [reportA, reportB]);

  const mismatchCount = rows.filter((row) => !row.statusMatch && row.a && row.b).length;
  const answerMismatchCount = rows.filter(
    (row) => row.a && row.b && row.answerMatch === false,
  ).length;

  const displayRows = useMemo(() => {
    if (!answerDiffsOnly) return rows;
    return rows.filter((row) => row.a && row.b && row.answerMatch === false);
  }, [rows, answerDiffsOnly]);

  const compareMetrics = useMemo(() => {
    if (!reportA || !reportB) return null;
    return buildCompareMetrics(reportA, reportB);
  }, [reportA, reportB]);

  function handleCompareSuite(group: SavedWorkflowTest[]) {
    if (group.length < 2) return;
    setTestAId(group[0]!.id);
    setTestBId(group[1]!.id);
    setRunAId("");
    setRunBId("");
  }

  async function handleLoadCompare() {
    if (!runAId || !runBId) {
      onError("Select a run for both sides.");
      return;
    }
    setLoadingCompare(true);
    try {
      const [a, b] = await Promise.all([
        getWorkflowTestRun(runAId),
        getWorkflowTestRun(runBId),
      ]);
      setReportA(a);
      setReportB(b);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load reports.");
    } finally {
      setLoadingCompare(false);
    }
  }

  const filteredTestsA = useMemo(() => {
    if (!testB?.suiteKey) return tests;
    return tests.filter(
      (test) => test.suiteKey === testB.suiteKey || test.id === testAId,
    );
  }, [tests, testB, testAId]);

  const filteredTestsB = useMemo(() => {
    if (!testA?.suiteKey) return tests;
    return tests.filter(
      (test) => test.suiteKey === testA.suiteKey || test.id === testBId,
    );
  }, [tests, testA, testBId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Compare runs</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick two saved tests (ideally the same suite with different agents) and
          compare their latest or selected runs side-by-side. Expand a row to review
          full final answers per query for manual assessment.
        </p>
      </div>

      {suitePairs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Compare suite shortcuts</p>
          <div className="flex flex-wrap gap-2">
            {suitePairs.map((group) => {
              const suiteLabel = group[0]?.name.split(" — ")[0] ?? "Suite";
              const agents = group
                .map((test) => test.agent?.name ?? "default")
                .join(" vs ");
              return (
                <Button
                  key={group[0]!.suiteKey ?? group[0]!.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => handleCompareSuite(group)}
                >
                  {suiteLabel}: {agents}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tests…</p>
      ) : tests.length === 0 ? (
        <EmptyState
          title="No saved tests"
          description="Save workflow tests from Setup to compare runs across agents."
          className="py-8"
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-xs font-semibold text-foreground">Side A</p>
              <FormFieldSelect
                id="compare-test-a"
                label="Saved test"
                value={testAId}
                onChange={(value) => {
                  setTestAId(value);
                  setRunAId("");
                }}
                options={filteredTestsA.map((test) => ({
                  value: test.id,
                  label: `${test.name}${test.agent ? ` · ${test.agent.name}` : ""}`,
                }))}
              />
              <FormFieldSelect
                id="compare-run-a"
                label="Run"
                value={runAId}
                onChange={setRunAId}
                disabled={!detailA}
                options={(detailA?.runs ?? []).map((run) => ({
                  value: run.id,
                  label: `${new Date(run.ranAt).toLocaleString()} — ${run.summary.passed}P/${run.summary.failed}F`,
                }))}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-xs font-semibold text-foreground">Side B</p>
              <FormFieldSelect
                id="compare-test-b"
                label="Saved test"
                value={testBId}
                onChange={(value) => {
                  setTestBId(value);
                  setRunBId("");
                }}
                options={filteredTestsB.map((test) => ({
                  value: test.id,
                  label: `${test.name}${test.agent ? ` · ${test.agent.name}` : ""}`,
                }))}
              />
              <FormFieldSelect
                id="compare-run-b"
                label="Run"
                value={runBId}
                onChange={setRunBId}
                disabled={!detailB}
                options={(detailB?.runs ?? []).map((run) => ({
                  value: run.id,
                  label: `${new Date(run.ranAt).toLocaleString()} — ${run.summary.passed}P/${run.summary.failed}F`,
                }))}
              />
            </div>
          </div>

          <Button
            type="button"
            disabled={!runAId || !runBId || loadingCompare}
            loading={loadingCompare}
            onClick={() => void handleLoadCompare()}
          >
            Compare selected runs
          </Button>
        </>
      )}

      {reportA && reportB && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <SideSummary label="Side A" report={reportA} test={testA} />
            <SideSummary label="Side B" report={reportB} test={testB} />
          </div>

          {compareMetrics && (
            <WorkflowTestMetricsDashboard mode="compare" compare={compareMetrics} />
          )}

          {overlapCount < Math.min(reportA.results.length, reportB.results.length) && (
            <Alert variant="warning">
              Query sets do not fully overlap ({overlapCount} shared quer
              {overlapCount === 1 ? "y" : "ies"}). Rows without a match on one side
              are still shown.
            </Alert>
          )}

          {mismatchCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {mismatchCount} quer{mismatchCount === 1 ? "y has" : "ies have"} different
              status between sides.
            </p>
          )}

          {answerMismatchCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {answerMismatchCount} quer{answerMismatchCount === 1 ? "y has" : "ies have"}{" "}
              different final answers — expand rows to compare side-by-side.
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="rounded border-input"
              checked={answerDiffsOnly}
              onChange={(e) => setAnswerDiffsOnly(e.target.checked)}
            />
            Show only queries with different final answers
          </label>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Query</TableHead>
                <TableHead>A status</TableHead>
                <TableHead>B status</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead>A tokens</TableHead>
                <TableHead>B tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                const expanded = expandedKey === row.queryKey;
                const statusDiffers = row.a && row.b && row.a.status !== row.b.status;
                const answerDiffers = row.a && row.b && row.answerMatch === false;
                return (
                  <Fragment key={row.queryKey}>
                    <TableRow
                      className={cn(
                        statusDiffers && "bg-destructive/5",
                        answerDiffers && !statusDiffers && "bg-amber-500/5",
                      )}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="focus-ring rounded p-0.5"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedKey(expanded ? null : row.queryKey)
                          }
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="truncate text-xs font-medium">{row.groupName}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.query}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.a?.status)} className="normal-case">
                          {statusLabel(row.a?.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.b?.status)} className="normal-case">
                          {statusLabel(row.b?.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.a && row.b ? (
                          row.statusMatch ? (
                            <Badge variant="success" className="normal-case">yes</Badge>
                          ) : (
                            <Badge variant="destructive" className="normal-case">no</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="normal-case">—</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.a && row.b ? (
                          row.answerMatch ? (
                            <Badge variant="success" className="normal-case">yes</Badge>
                          ) : (
                            <Badge variant="destructive" className="normal-case">no</Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="normal-case">—</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {formatTokens(row.a?.totalTokens)}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {formatTokens(row.b?.totalTokens)}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/10">
                          <div className="space-y-4 py-2">
                            <div>
                              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {row.groupName}
                              </p>
                              <p className="mt-1 text-sm text-foreground">{row.query}</p>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <FinalAnswerPanel side="A" result={row.a} />
                              <FinalAnswerPanel side="B" result={row.b} />
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                              <CompareDetail side="A" result={row.a} />
                              <CompareDetail side="B" result={row.b} />
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function FormFieldSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FinalAnswerPanel({
  side,
  result,
}: {
  side: string;
  result?: import("../../api").QueryRunResult;
}) {
  const answer = finalAnswerText(result);
  const isError = Boolean(result?.errorMessage && !result.markdownResponse?.trim());

  if (!result) {
    return (
      <InspectSection title={`Side ${side} — final answer`}>
        <p className="text-xs text-muted-foreground">No result on this side.</p>
      </InspectSection>
    );
  }

  return (
    <InspectSection
      title={`Side ${side} — final answer`}
      variant={isError ? "destructive" : "default"}
    >
      {answer ? (
        isError ? (
          <InspectCodeBlock value={answer} />
        ) : (
          <MarkdownContent content={answer} compact />
        )
      ) : (
        <p className="text-xs text-muted-foreground">No formatted answer recorded.</p>
      )}
    </InspectSection>
  );
}

function CompareDetail({
  side,
  result,
}: {
  side: string;
  result?: import("../../api").QueryRunResult;
}) {
  if (!result) {
    return (
      <div className="text-xs text-muted-foreground">No result on side {side}.</div>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-foreground">Side {side}</p>
      <p className="text-muted-foreground">
        Phase: {result.failurePhase === "none" ? "—" : result.failurePhase}
        {result.failedNode ? ` · node: ${result.failedNode}` : ""}
      </p>
      {result.generatedSql && (
        <InspectSection title="Generated SQL">
          <InspectCodeBlock value={result.generatedSql} language="sql" />
        </InspectSection>
      )}
      {result.errorMessage && !result.markdownResponse?.trim() && (
        <InspectSection title="Error" variant="destructive">
          <InspectCodeBlock value={result.errorMessage} />
        </InspectSection>
      )}
    </div>
  );
}
