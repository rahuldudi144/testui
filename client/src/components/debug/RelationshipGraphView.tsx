import { useMemo } from "react";
import { Badge } from "../ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/Table";
import {
  flattenRelationshipGraph,
  relationshipGraphStats,
  type RelationshipGraph,
} from "./relationshipGraph";

interface Props {
  graph: RelationshipGraph;
  compact?: boolean;
}

export function RelationshipGraphView({ graph, compact = false }: Props) {
  const edges = useMemo(() => flattenRelationshipGraph(graph), [graph]);
  const stats = useMemo(() => relationshipGraphStats(graph), [graph]);

  if (edges.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No foreign-key edges were recorded in the relationship graph.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="normal-case">
          {stats.tableCount} tables
        </Badge>
        <Badge variant="outline" className="normal-case">
          {stats.edgeCount} FK edges
        </Badge>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From table</TableHead>
              <TableHead>Column</TableHead>
              <TableHead className="w-8 text-center">→</TableHead>
              <TableHead>To table</TableHead>
              <TableHead>Column</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {edges.map((edge, index) => (
              <TableRow key={`${edge.fromTable}-${edge.fromColumn}-${edge.toTable}-${index}`}>
                <TableCell className="font-mono text-[11px]">{edge.fromTable}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {edge.fromColumn}
                </TableCell>
                <TableCell className="text-center text-muted-foreground">→</TableCell>
                <TableCell className="font-mono text-[11px]">{edge.toTable}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {edge.toColumn}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Built from schema foreign keys at the graphBuilder step. Used by entity extraction and
          join-path finding.
        </p>
      )}
    </div>
  );
}
