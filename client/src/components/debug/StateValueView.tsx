import { formatStateFieldValue } from "./formatStateValue";
import { EntitiesView } from "./EntitiesView";
import { JoinPathsView } from "./JoinPathsView";
import { isJoinPaths, isStringList } from "./nodeDebugState";
import { OperationsView } from "./OperationsView";
import { isRelationshipGraph } from "./relationshipGraph";
import { RelationshipGraphView } from "./RelationshipGraphView";

interface Props {
  fieldKey: string;
  value: unknown;
  compact?: boolean;
}

export function StateValueView({ fieldKey, value, compact = false }: Props) {
  if (fieldKey === "graph" && isRelationshipGraph(value)) {
    return <RelationshipGraphView graph={value} compact={compact} />;
  }
  if (fieldKey === "joinPaths" && isJoinPaths(value)) {
    return <JoinPathsView joinPaths={value} compact={compact} />;
  }
  if (fieldKey === "operations" && isStringList(value)) {
    return <OperationsView operations={value} compact={compact} />;
  }
  if (fieldKey === "entities" && isStringList(value)) {
    return <EntitiesView entities={value} compact={compact} />;
  }

  return (
    <pre className="wrap-break-word whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
      {formatStateFieldValue(fieldKey, value)}
    </pre>
  );
}
