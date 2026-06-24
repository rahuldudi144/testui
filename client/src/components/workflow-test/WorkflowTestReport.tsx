import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import type { QueryRunResult, WorkflowTestCompletePayload } from "../../api";
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

function ResultInspector({ result }: { result: QueryRunResult }) {
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
          { label: "Workflow status", value: result.workflowStatus ?? "—" },
          { label: "Request ID", value: result.requestId ?? "—" },
        ]}
      />

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
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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

  const { summary } = report;
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
        <Button type="button" variant="secondary" size="sm" onClick={exportJson}>
          <Download className="h-4 w-4" />
          Export JSON
        </Button>
      </div>

      <InspectSection title="Run summary">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">{summary.passed} passed</Badge>
            <Badge variant="destructive">{summary.failed} failed</Badge>
            <Badge variant="destructive">{summary.errors} errors</Badge>
            <Badge variant="outline">{summary.plannerSkipped} planner skip</Badge>
            <Badge variant="info">{summary.total} total</Badge>
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
                </TableRow>
                {expanded && (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={7}>
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
