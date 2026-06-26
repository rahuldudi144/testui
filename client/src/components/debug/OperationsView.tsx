import { Badge } from "../ui/Badge";

interface Props {
  operations: string[];
  compact?: boolean;
}

export function OperationsView({ operations, compact = false }: Props) {
  if (operations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No SQL operations were planned.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {operations.map((operation) => (
          <Badge key={operation} variant="info" className="normal-case font-mono">
            {operation}
          </Badge>
        ))}
      </div>

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Planned SQL operations from operationPlanner (e.g. JOIN, GROUP BY, ORDER BY).
        </p>
      )}
    </div>
  );
}
