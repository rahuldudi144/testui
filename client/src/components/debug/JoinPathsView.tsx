import { Badge } from "../ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";
import type { JoinCondition } from "./nodeDebugState";

interface Props {
  joinPaths: JoinCondition[];
  compact?: boolean;
}

export function JoinPathsView({ joinPaths, compact = false }: Props) {
  if (joinPaths.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No join paths were recorded for the extracted entities.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Badge variant="outline" className="normal-case">
        {joinPaths.length} join{joinPaths.length === 1 ? "" : "s"}
      </Badge>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Left table</TableHead>
              <TableHead>Column</TableHead>
              <TableHead className="w-8 text-center">=</TableHead>
              <TableHead>Right table</TableHead>
              <TableHead>Column</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {joinPaths.map((join, index) => (
              <TableRow
                key={`${join.leftTable}-${join.leftColumn}-${join.rightTable}-${index}`}
              >
                <TableCell className="font-mono text-[11px]">{join.leftTable}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {join.leftColumn}
                </TableCell>
                <TableCell className="text-center text-muted-foreground">=</TableCell>
                <TableCell className="font-mono text-[11px]">{join.rightTable}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {join.rightColumn}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          BFS join plan from pathFinder connecting the extracted entities.
        </p>
      )}
    </div>
  );
}
