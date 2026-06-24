import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";

interface Props {
  testName: string;
  groupName?: string;
  query?: string;
  queryIndex: number;
  totalQueries: number;
  onCancel: () => void;
}

export function WorkflowTestProgress({
  testName,
  groupName,
  query,
  queryIndex,
  totalQueries,
  onCancel,
}: Props) {
  const pct =
    totalQueries > 0 ? Math.round((queryIndex / totalQueries) * 100) : 0;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Spinner className="h-4 w-4" />
          <span className="text-sm font-medium text-foreground">
            Running workflow test: {testName}
          </span>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Query {Math.min(queryIndex, totalQueries)} of {totalQueries}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {groupName && (
        <p className="text-xs text-muted-foreground">
          Group: <span className="font-medium text-foreground">{groupName}</span>
        </p>
      )}
      {query && (
        <p className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
          {query}
        </p>
      )}
    </div>
  );
}
