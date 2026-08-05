import { useEffect, useState } from "react";
import type { QueryRunResult } from "../../api";
import { formatDurationEstimate } from "../../lib/workflowTestEta";
import {
  categoryTypeLabel,
  formatOutcomeLabel,
  isFatalAbortMessage,
} from "../../lib/workflowTestReportHelpers";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { LiveFlaskIcon } from "./LiveFlaskIcon";
import { WorkflowTestProgressBar } from "./WorkflowTestProgressBar";

interface Props {
  testName: string;
  groupName?: string;
  query?: string;
  queryIndex: number;
  totalQueries: number;
  completedQueries?: number;
  estimatedRemainingMs?: number;
  categoryType?: string;
  expectedOutcome?: string;
  latestActivity?: string | null;
  activityLog?: string[];
  liveResults?: QueryRunResult[];
  onCancel: () => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusVariant(
  status: QueryRunResult["status"],
): "success" | "destructive" | "outline" {
  if (status === "pass") return "success";
  if (status === "fail" || status === "error") return "destructive";
  return "outline";
}

function ElapsedTime() {
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return <span>{formatElapsed(elapsedMs)}</span>;
}

export function WorkflowTestProgress({
  testName,
  groupName,
  query,
  queryIndex,
  totalQueries,
  completedQueries = 0,
  estimatedRemainingMs,
  categoryType,
  expectedOutcome,
  latestActivity,
  activityLog = [],
  liveResults = [],
  onCancel,
}: Props) {
  const inFlight = queryIndex > completedQueries;
  const completedPct =
    totalQueries > 0 ? Math.round((completedQueries / totalQueries) * 100) : 0;
  const showCompletedPct = !inFlight || completedQueries > 0;
  const fatalAbort =
    (latestActivity && isFatalAbortMessage(latestActivity) ? latestActivity : null) ??
    liveResults.find((r) => isFatalAbortMessage(r.errorMessage))?.errorMessage ??
    null;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LiveFlaskIcon iconClassName="text-primary" />
          <span className="text-sm font-medium text-foreground">
            Running workflow test: {testName}
          </span>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {fatalAbort && (
        <Alert variant="error">
          Run aborted due to a fatal provider error: {fatalAbort}
        </Alert>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {completedQueries} of {totalQueries} completed
            {inFlight && queryIndex > 0
              ? ` · working on query ${queryIndex}`
              : ""}
          </span>
          <span>
            <ElapsedTime />
            {totalQueries > 0
              ? showCompletedPct
                ? ` · ${completedPct}%`
                : " · in progress"
              : ""}
            {estimatedRemainingMs !== undefined
              ? ` · ${formatDurationEstimate(estimatedRemainingMs)} remaining`
              : ""}
          </span>
        </div>
        <WorkflowTestProgressBar
          completedQueries={completedQueries}
          totalQueries={totalQueries}
          queryIndex={queryIndex}
        />
      </div>

      {(groupName || categoryType || expectedOutcome) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {groupName && (
            <span>
              Group: <span className="font-medium text-foreground">{groupName}</span>
            </span>
          )}
          {categoryType && (
            <Badge variant="info" className="normal-case">
              {categoryTypeLabel(categoryType)}
            </Badge>
          )}
          {expectedOutcome && (
            <Badge variant="outline" className="normal-case">
              Expected: {formatOutcomeLabel(expectedOutcome)}
            </Badge>
          )}
        </div>
      )}
      {query && (
        <p className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
          {query}
        </p>
      )}

      {latestActivity && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">Activity:</span>{" "}
          {latestActivity}
        </p>
      )}

      {liveResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Recent results ({liveResults.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {liveResults.slice(-8).map((result, index) => (
              <Badge
                key={`${result.queryKey ?? result.query}-${index}`}
                variant={statusVariant(result.status)}
                className="max-w-full truncate normal-case"
                title={result.query}
              >
                {result.actualOutcome
                  ? formatOutcomeLabel(result.actualOutcome)
                  : result.status}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {activityLog.length > 0 && (
        <div className="rounded-md border border-border bg-background/80">
          <p className="border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Agent log
          </p>
          <div className="max-h-40 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {activityLog.slice(-20).map((line, index) => (
              <p key={`${index}-${line.slice(0, 24)}`} className="truncate">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
