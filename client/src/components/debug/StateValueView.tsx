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
  if (fieldKey === "businessConcepts" && isStringList(value)) {
    return <EntitiesView entities={value} compact={compact} />;
  }
  if (
    (fieldKey === "startingDocumentIds" || fieldKey === "requiredDocumentIds") &&
    isStringList(value)
  ) {
    return <EntitiesView entities={value} compact={compact} />;
  }
  if (fieldKey === "knowledgeContext" && Array.isArray(value)) {
    const tables = value
      .map((doc) =>
        doc && typeof doc === "object" && "table" in doc
          ? String((doc as { table: unknown }).table)
          : null,
      )
      .filter((t): t is string => Boolean(t));
    if (tables.length > 0) {
      return <EntitiesView entities={tables} compact={compact} />;
    }
  }

  return (
    <pre className="wrap-break-word whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
      {formatStateFieldValue(fieldKey, value)}
    </pre>
  );
}
