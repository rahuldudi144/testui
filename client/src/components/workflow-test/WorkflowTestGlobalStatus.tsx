import { FlaskConical, RotateCcw, X } from "lucide-react";
import { useWorkflowTestRunner } from "../../context/WorkflowTestRunnerContext";
import { isResumableWorkflowRun } from "../../api";
import { LiveFlaskIcon } from "./LiveFlaskIcon";
import { WorkflowTestProgressBar } from "./WorkflowTestProgressBar";
import { Button } from "../ui/Button";

interface Props {
  onOpenWorkflowTest: () => void;
}

export function WorkflowTestGlobalStatus({ onOpenWorkflowTest }: Props) {
  const {
    running,
    testName,
    progress,
    liveResults,
    latestActivity,
    report,
    showCompletedBanner,
    cancel,
    rerun,
    resumeFromRun,
    dismissCompletedBanner,
  } = useWorkflowTestRunner();

  if (!running && !(showCompletedBanner && report)) {
    return null;
  }

  const completed = Math.max(progress.completedQueries, liveResults.length);
  const inFlight = progress.queryIndex > completed;
  const completedPct =
    progress.totalQueries > 0
      ? Math.round((completed / progress.totalQueries) * 100)
      : 0;
  const showCompletedPct = !inFlight || completed > 0;
  const isPartialReport = report ? isResumableWorkflowRun(report) : false;

  return (
    <div
      className="shrink-0 border-b border-border bg-card/90 px-4 py-2 backdrop-blur-sm md:px-6"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            {running ? (
              <LiveFlaskIcon className="shrink-0" iconClassName="text-primary" />
            ) : (
              <FlaskConical className="h-4 w-4 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {running
                  ? "Workflow test running"
                  : isPartialReport
                    ? "Workflow test stopped early"
                    : "Workflow test complete"}
                {testName ? `: ${testName}` : ""}
              </p>
              {running ? (
                <p className="truncate text-xs text-muted-foreground">
                  {completed} of {progress.totalQueries} completed
                  {inFlight && progress.queryIndex > 0
                    ? ` · query ${progress.queryIndex}`
                    : ""}
                  {progress.groupName ? ` · ${progress.groupName}` : ""}
                  {progress.totalQueries > 0
                    ? showCompletedPct
                      ? ` · ${completedPct}%`
                      : " · in progress"
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
          {running && progress.totalQueries > 0 && (
            <WorkflowTestProgressBar
              size="sm"
              completedQueries={completed}
              totalQueries={progress.totalQueries}
              queryIndex={progress.queryIndex}
              className="max-w-md"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onOpenWorkflowTest}>
            {running ? "View progress" : "View report"}
          </Button>
          {!running && report && isPartialReport && report.runId && (
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
          {!running && report && !isPartialReport && (
            <Button type="button" size="sm" variant="secondary" onClick={() => void rerun()}>
              <RotateCcw className="h-4 w-4" />
              Rerun
            </Button>
          )}
          {running ? (
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          ) : (
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
