import { FlaskConical, RotateCcw, X } from "lucide-react";
import {
  useWorkflowTestLiveProgress,
  useWorkflowTestRunState,
} from "../../context/WorkflowTestRunnerContext";
import { isResumableWorkflowRun } from "../../api";
import { formatDurationEstimate } from "../../lib/workflowTestEta";
import { clampProgressCounts } from "../../lib/workflowTestGroups";
import { LiveFlaskIcon } from "./LiveFlaskIcon";
import { WorkflowTestProgressBar } from "./WorkflowTestProgressBar";
import { Button } from "../ui/Button";

interface Props {
  onOpenWorkflowTest: () => void;
}

export function WorkflowTestGlobalStatus({ onOpenWorkflowTest }: Props) {
  const {
    running,
    reconnecting,
    testName,
    report,
    showCompletedBanner,
    cancel,
    rerun,
    resumeFromRun,
    dismissCompletedBanner,
  } = useWorkflowTestRunState();
  const { progress, latestActivity } = useWorkflowTestLiveProgress();

  if (!running && !reconnecting && !(showCompletedBanner && report)) {
    return null;
  }

  const { completed, total, queryIndex, pct } = clampProgressCounts({
    completed: progress.completedQueries,
    total: progress.totalQueries,
    queryIndex: progress.queryIndex,
  });
  const inFlight = queryIndex > completed;
  const completedPct = pct;
  const showCompletedPct = !inFlight || completed > 0;
  const isPartialReport = report ? isResumableWorkflowRun(report) : false;
  const statusTitle = reconnecting
    ? "Reconnecting…"
    : running
      ? "Workflow test running"
      : isPartialReport
        ? "Workflow test stopped early"
        : "Workflow test complete";

  return (
    <div
      className="shrink-0 border-b border-border bg-card/90 px-4 py-2 backdrop-blur-sm md:px-6"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            {running || reconnecting ? (
              <LiveFlaskIcon className="shrink-0" iconClassName="text-primary" />
            ) : (
              <FlaskConical className="h-4 w-4 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {statusTitle}
                {testName ? `: ${testName}` : ""}
              </p>
              {running || reconnecting ? (
                <p className="truncate text-xs text-muted-foreground">
                  {completed} of {total} completed
                  {inFlight && queryIndex > 0 ? ` · query ${queryIndex}` : ""}
                  {progress.groupName ? ` · ${progress.groupName}` : ""}
                  {total > 0
                    ? showCompletedPct
                      ? ` · ${completedPct}%`
                      : " · in progress"
                    : ""}
                  {progress.estimatedRemainingMs !== undefined
                    ? ` · ${formatDurationEstimate(progress.estimatedRemainingMs)} remaining`
                    : ""}
                  {latestActivity ? ` · ${latestActivity}` : ""}
                </p>
              ) : report ? (
                <p className="text-xs text-muted-foreground">
                  {isPartialReport ? (
                    <>
                      {report.results.length} of{" "}
                      {report.summary.plannedQueries ?? report.results.length}{" "}
                      completed · {report.summary.passed} passed,{" "}
                      {report.summary.failed} failed, {report.summary.errors} errors
                    </>
                  ) : (
                    <>
                      {report.summary.passed} passed, {report.summary.failed} failed,{" "}
                      {report.summary.errors} errors
                    </>
                  )}
                </p>
              ) : null}
            </div>
          </div>
          {(running || reconnecting) && total > 0 && (
            <WorkflowTestProgressBar
              size="sm"
              completedQueries={completed}
              totalQueries={total}
              queryIndex={queryIndex}
              className="max-w-md"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onOpenWorkflowTest}>
            {running || reconnecting ? "View progress" : "View report"}
          </Button>
          {!running && !reconnecting && report && isPartialReport && report.runId && (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                void resumeFromRun(report.runId!, {
                  testName: report.testName,
                  dryRun: report.dryRun,
                  delayMs: report.delayMs ?? 0,
                })
              }
            >
              <RotateCcw className="h-4 w-4" />
              Resume
            </Button>
          )}
          {!running && !reconnecting && report && !isPartialReport && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void rerun()}>
              <RotateCcw className="h-4 w-4" />
              Rerun
            </Button>
          )}
          {running ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          ) : reconnecting ? null : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Dismiss"
              onClick={dismissCompletedBanner}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
