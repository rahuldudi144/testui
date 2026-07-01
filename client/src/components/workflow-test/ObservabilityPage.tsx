import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  getPlatformUsage,
  type PlatformUsageResponse,
  type UsageTotals,
} from "../../api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";
import { InspectSection } from "./InspectBlocks";

function formatTokens(value: number): string {
  return value.toLocaleString();
}

function TotalsGrid({ title, totals }: { title: string; totals: UsageTotals }) {
  return (
    <InspectSection title={title}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="info">{totals.executionCount} executions</Badge>
        <Badge variant="outline">{formatTokens(totals.promptTokens)} prompt</Badge>
        <Badge variant="outline">
          {formatTokens(totals.completionTokens)} completion
        </Badge>
        <Badge variant="outline">{formatTokens(totals.totalTokens)} total tokens</Badge>
        <Badge variant="outline">{totals.llmCallCount} LLM calls</Badge>
      </div>
    </InspectSection>
  );
}

function sourceLabel(source: "workflow_test" | "chat"): string {
  return source === "workflow_test" ? "Workflow test" : "Chat";
}

export function ObservabilityPage() {
  const [usage, setUsage] = useState<PlatformUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlatformUsage();
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data.");
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !usage) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Loading platform usage…
      </p>
    );
  }

  if (error && !usage) {
    return (
      <EmptyState
        title="Could not load usage"
        description={error}
        action={
          <Button type="button" onClick={() => void refresh()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!usage) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Platform usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Token usage across workflow tests and chat conversations.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <TotalsGrid title="All sources" totals={usage.totals} />
      <TotalsGrid title="Workflow tests" totals={usage.bySource.workflow_test} />
      <TotalsGrid title="Chat" totals={usage.bySource.chat} />

      <InspectSection title="Recent executions">
        {usage.recentExecutions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No executions recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ran at</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Query</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Total tokens</TableHead>
                <TableHead>LLM calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.recentExecutions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(row.ranAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">{sourceLabel(row.source)}</TableCell>
                  <TableCell
                    className="max-w-[240px] truncate text-xs"
                    title={row.query}
                  >
                    {row.query}
                  </TableCell>
                  <TableCell className="text-xs">{row.groupName ?? "—"}</TableCell>
                  <TableCell className="text-xs">{row.status ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {row.attemptNumber}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {formatTokens(row.totalTokens)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {row.llmCallCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </InspectSection>
    </div>
  );
}
