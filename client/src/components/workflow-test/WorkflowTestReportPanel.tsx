import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getWorkflowTest,
  getWorkflowTestRun,
  listWorkflowTests,
  type SavedWorkflowTest,
  type WorkflowTestCompletePayload,
} from "../../api";
import { WorkflowTestReport } from "./WorkflowTestReport";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Label } from "../ui/Label";

interface Props {
  contextReport: WorkflowTestCompletePayload | null;
  refreshToken?: number;
  onError: (message: string) => void;
  onReportChange?: (report: WorkflowTestCompletePayload) => void;
}

function formatRunLabel(run: {
  id: string;
  ranAt: string;
  dryRun: boolean;
  summary: { passed: number; failed: number; errors: number; runStatus?: string };
}): string {
  const status =
    run.summary.runStatus && run.summary.runStatus !== "completed"
      ? ` · ${run.summary.runStatus}`
      : "";
  return `${new Date(run.ranAt).toLocaleString()} — ${run.summary.passed}P/${run.summary.failed}F/${run.summary.errors}E${run.dryRun ? " · dry run" : ""}${status}`;
}

export function WorkflowTestReportPanel({
  contextReport,
  refreshToken,
  onError,
  onReportChange,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tests, setTests] = useState<SavedWorkflowTest[]>([]);
  const [loadingTests, setLoadingTests] = useState(true);
  const [testId, setTestId] = useState("");
  const [runId, setRunId] = useState("");
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getWorkflowTest>> | null>(
    null,
  );
  const [report, setReport] = useState<WorkflowTestCompletePayload | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const initializedRef = useRef(false);
  const lastContextRunIdRef = useRef<string | null>(null);

  const runIdFromUrl = searchParams.get("runId");

  const refreshTests = useCallback(async () => {
    setLoadingTests(true);
    try {
      const list = await listWorkflowTests();
      setTests(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load saved tests.");
    } finally {
      setLoadingTests(false);
    }
  }, [onError]);

  useEffect(() => {
    void refreshTests();
  }, [refreshTests, refreshToken]);

  useEffect(() => {
    const contextRunId = contextReport?.runId ?? null;
    if (!contextRunId || contextRunId === lastContextRunIdRef.current) return;
    lastContextRunIdRef.current = contextRunId;
    if (contextReport.testId) setTestId(contextReport.testId);
    setRunId(contextRunId);
  }, [contextReport?.runId, contextReport?.testId]);

  useEffect(() => {
    if (initializedRef.current || loadingTests || tests.length === 0) return;
    if (runId || contextReport?.runId || runIdFromUrl) {
      initializedRef.current = true;
      return;
    }
    const withRun = tests.find((test) => test.lastRun);
    if (withRun?.lastRun) {
      setTestId(withRun.id);
      setRunId(withRun.lastRun.id);
    }
    initializedRef.current = true;
  }, [tests, loadingTests, runId, contextReport?.runId, runIdFromUrl]);

  useEffect(() => {
    if (!runIdFromUrl || runIdFromUrl === runId) return;
    setRunId(runIdFromUrl);
  }, [runIdFromUrl, runId]);

  useEffect(() => {
    if (!testId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    void getWorkflowTest(testId)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load test runs.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [testId, refreshToken, onError]);

  useEffect(() => {
    if (!runId) {
      setReport(null);
      return;
    }

    let cancelled = false;
    setLoadingReport(true);
    void getWorkflowTestRun(runId)
      .then((loaded) => {
        if (cancelled) return;
        setReport(loaded);
        if (loaded.testId) setTestId(loaded.testId);
        onReportChange?.(loaded);
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("runId", runId);
            return next;
          },
          { replace: true },
        );
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load report.");
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId, onError, onReportChange, setSearchParams]);

  const selectedTest = useMemo(
    () => tests.find((test) => test.id === testId) ?? null,
    [tests, testId],
  );

  function handleTestChange(nextTestId: string) {
    setTestId(nextTestId);
    setRunId("");
    setReport(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("runId");
        return next;
      },
      { replace: true },
    );
  }

  function handleRunChange(nextRunId: string) {
    setRunId(nextRunId);
  }

  async function handleReload() {
    if (!runId) return;
    setLoadingReport(true);
    try {
      const loaded = await getWorkflowTestRun(runId);
      setReport(loaded);
      onReportChange?.(loaded);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load report.");
    } finally {
      setLoadingReport(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Report</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a saved test and run to review metrics, pass/fail breakdown, and
          per-query details.
        </p>
      </div>

      {loadingTests ? (
        <p className="text-sm text-muted-foreground">Loading saved tests…</p>
      ) : tests.length === 0 ? (
        <EmptyState
          title="No saved tests"
          description="Run a workflow test from Setup to save reports you can browse here."
          className="py-8"
        />
      ) : (
        <div className="grid gap-4 rounded-lg border border-border p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <FormFieldSelect
            id="report-test"
            label="Saved test"
            value={testId}
            onChange={handleTestChange}
            options={tests.map((test) => ({
              value: test.id,
              label: `${test.name}${test.agent ? ` · ${test.agent.name}` : ""}`,
            }))}
          />
          <FormFieldSelect
            id="report-run"
            label="Run"
            value={runId}
            onChange={handleRunChange}
            disabled={!detail}
            options={(detail?.runs ?? []).map((run) => ({
              value: run.id,
              label: formatRunLabel(run),
            }))}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!runId || loadingReport}
            loading={loadingReport}
            onClick={() => void handleReload()}
          >
            Reload
          </Button>
        </div>
      )}

      {selectedTest && detail && detail.runs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No runs saved for {selectedTest.name} yet.
        </p>
      )}

      {loadingReport && !report && (
        <p className="text-sm text-muted-foreground">Loading report…</p>
      )}

      {report && <WorkflowTestReport report={report} />}
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
