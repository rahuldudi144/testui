import { Badge } from "../ui/Badge";

interface Props {
  entities: string[];
  compact?: boolean;
}

export function EntitiesView({ entities, compact = false }: Props) {
  if (entities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No entities were extracted.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {entities.map((entity) => (
          <Badge key={entity} variant="outline" className="normal-case font-mono">
            {entity}
          </Badge>
        ))}
      </div>

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Tables identified by entityExtractor for this question.
        </p>
      )}
    </div>
  );
}
