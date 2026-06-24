import { FlaskConical, RotateCcw, X } from "lucide-react";
import { useWorkflowTestRunner } from "../../context/WorkflowTestRunnerContext";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

interface Props {
  onOpenWorkflowTest: () => void;
}

export function WorkflowTestGlobalStatus({ onOpenWorkflowTest }: Props) {
  const {
    running,
    testName,
    progress,
    report,
    showCompletedBanner,
    cancel,
    rerun,
    dismissCompletedBanner,
  } = useWorkflowTestRunner();

  if (!running && !(showCompletedBanner && report)) {
    return null;
  }

  const pct =
    progress.totalQueries > 0
      ? Math.round((progress.queryIndex / progress.totalQueries) * 100)
      : 0;

  return (
    <div
      className="shrink-0 border-b border-border bg-card/90 px-4 py-2 backdrop-blur-sm md:px-6"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <Spinner className="h-4 w-4 shrink-0" />
          ) : (
            <FlaskConical className="h-4 w-4 shrink-0 text-success" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {running ? "Workflow test running" : "Workflow test complete"}
              {testName ? `: ${testName}` : ""}
            </p>
            {running ? (
              <p className="truncate text-xs text-muted-foreground">
                Query {Math.min(progress.queryIndex, progress.totalQueries)} of{" "}
                {progress.totalQueries}
                {progress.groupName ? ` · ${progress.groupName}` : ""}
                {progress.totalQueries > 0 ? ` · ${pct}%` : ""}
              </p>
            ) : report ? (
              <p className="text-xs text-muted-foreground">
                {report.summary.passed} passed, {report.summary.failed} failed,{" "}
                {report.summary.errors} errors
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onOpenWorkflowTest}>
            {running ? "View progress" : "View report"}
          </Button>
          {!running && report && (
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
