import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";

interface ColumnRow {
  name: string;
  type?: string;
  description?: string;
}

interface TableRow {
  name: string;
  description?: string;
  columns: ColumnRow[];
}

function readDescription(object: Record<string, unknown>): string | undefined {
  if (typeof object.description === "string") {
    return object.description;
  }
  if (typeof object.purpose === "string") {
    return object.purpose;
  }
  return undefined;
}

function parseSchemaMetadata(metadata: unknown): TableRow[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }

  const record = metadata as Record<string, unknown>;
  const tables = record.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    return [];
  }

  return Object.entries(tables as Record<string, unknown>)
    .map(([name, tableValue]) => {
      const table =
        tableValue && typeof tableValue === "object" && !Array.isArray(tableValue)
          ? (tableValue as Record<string, unknown>)
          : {};
      const description = readDescription(table);
      const rawColumns = table.columns;
      const columns: ColumnRow[] = Array.isArray(rawColumns)
        ? rawColumns
            .map((column) => {
              if (!column || typeof column !== "object" || Array.isArray(column)) {
                return null;
              }
              const col = column as Record<string, unknown>;
              const colName = typeof col.name === "string" ? col.name : null;
              if (!colName) return null;
              return {
                name: colName,
                type: typeof col.type === "string" ? col.type : undefined,
                description: readDescription(col),
              };
            })
            .filter((column): column is ColumnRow => column !== null)
        : [];

      return { name, description, columns };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function cloneMetadata(metadata: unknown): unknown {
  if (metadata === undefined || metadata === null) return metadata;
  return structuredClone(metadata);
}

function applyTableDescription(
  metadata: unknown,
  tableName: string,
  description: string,
): unknown {
  const next = cloneMetadata(metadata);
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;

  const record = next as Record<string, unknown>;
  const tables = record.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return next;

  const table = (tables as Record<string, unknown>)[tableName];
  if (!table || typeof table !== "object" || Array.isArray(table)) return next;

  const tableRecord = table as Record<string, unknown>;
  delete tableRecord.purpose;
  if (description.trim()) {
    tableRecord.description = description;
  } else {
    delete tableRecord.description;
  }

  return next;
}

function applyColumnDescription(
  metadata: unknown,
  tableName: string,
  columnName: string,
  description: string,
): unknown {
  const next = cloneMetadata(metadata);
  if (!next || typeof next !== "object" || Array.isArray(next)) return next;

  const record = next as Record<string, unknown>;
  const tables = record.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return next;

  const table = (tables as Record<string, unknown>)[tableName];
  if (!table || typeof table !== "object" || Array.isArray(table)) return next;

  const tableRecord = table as Record<string, unknown>;
  const columns = tableRecord.columns;
  if (!Array.isArray(columns)) return next;

  for (const column of columns) {
    if (!column || typeof column !== "object" || Array.isArray(column)) continue;
    const col = column as Record<string, unknown>;
    if (col.name !== columnName) continue;
    delete col.purpose;
    if (description.trim()) {
      col.description = description;
    } else {
      delete col.description;
    }
    break;
  }

  return next;
}

interface Props {
  metadata: unknown;
  className?: string;
  defaultExpanded?: boolean;
  editable?: boolean;
  onMetadataChange?: (metadata: unknown) => void;
}

export function SchemaMetadataView({
  metadata,
  className,
  defaultExpanded = false,
  editable = false,
  onMetadataChange,
}: Props) {
  const metadataKey = useMemo(() => JSON.stringify(metadata), [metadata]);
  const [draft, setDraft] = useState(metadata);
  const tables = useMemo(() => parseSchemaMetadata(draft), [draft]);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(() =>
    defaultExpanded ? new Set(parseSchemaMetadata(metadata).map((table) => table.name)) : new Set(),
  );
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setDraft(metadata);
  }, [metadataKey, metadata]);

  if (tables.length === 0) {
    return (
      <div className={cn("rounded-md border border-border bg-muted/20 p-3", className)}>
        <p className="text-sm text-muted-foreground">No schema tables to display.</p>
      </div>
    );
  }

  function toggleTable(name: string) {
    setExpandedTables((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function updateTableDescription(tableName: string, description: string) {
    const next = applyTableDescription(draft, tableName, description);
    setDraft(next);
    onMetadataChange?.(next);
  }

  function updateColumnDescription(
    tableName: string,
    columnName: string,
    description: string,
  ) {
    const next = applyColumnDescription(draft, tableName, columnName, description);
    setDraft(next);
    onMetadataChange?.(next);
  }

  const displayMetadata = editable ? draft : metadata;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {tables.length} table{tables.length === 1 ? "" : "s"}
          {editable
            ? " — edit description fields below"
            : " with LLM descriptions"}
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline focus-ring rounded"
          onClick={() => setShowRaw((value) => !value)}
        >
          {showRaw ? "Show table view" : "Show raw JSON"}
        </button>
      </div>

      {showRaw ? (
        <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
          {JSON.stringify(displayMetadata, null, 2)}
        </pre>
      ) : (
        <div className="max-h-96 space-y-2 overflow-auto rounded-md border border-border bg-muted/10 p-2">
          {tables.map((table) => {
            const expanded = expandedTables.has(table.name);
            return (
              <div
                key={table.name}
                className="overflow-hidden rounded-md border border-border bg-background"
              >
                <div className="flex items-start gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleTable(table.name)}
                    className="mt-0.5 shrink-0 rounded-md hover:bg-muted/40 focus-ring"
                    aria-expanded={expanded}
                    aria-label={expanded ? `Collapse ${table.name}` : `Expand ${table.name}`}
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{table.name}</span>
                      <Badge variant="outline" className="normal-case">
                        {table.columns.length} cols
                      </Badge>
                    </span>
                    {editable ? (
                      <div className="mt-2 space-y-1">
                        <Label
                          htmlFor={`table-description-${table.name}`}
                          className="text-xs text-muted-foreground"
                        >
                          Table description
                        </Label>
                        <Input
                          id={`table-description-${table.name}`}
                          value={table.description ?? ""}
                          onChange={(e) =>
                            updateTableDescription(table.name, e.target.value)
                          }
                          placeholder="What this table represents…"
                          className="h-8 text-xs"
                        />
                      </div>
                    ) : (
                      table.description && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {table.description}
                        </span>
                      )
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border px-3 py-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-1 pr-3 font-medium">Column</th>
                          <th className="pb-1 pr-3 font-medium">Type</th>
                          <th className="pb-1 font-medium">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.columns.map((column) => (
                          <tr key={column.name} className="border-t border-border/60">
                            <td className="py-1.5 pr-3 align-top font-mono text-foreground">
                              {column.name}
                            </td>
                            <td className="py-1.5 pr-3 align-top text-muted-foreground">
                              {column.type ?? "—"}
                            </td>
                            <td className="py-1.5 align-top">
                              {editable ? (
                                <Input
                                  value={column.description ?? ""}
                                  onChange={(e) =>
                                    updateColumnDescription(
                                      table.name,
                                      column.name,
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Column description…"
                                  className="h-8 min-w-[12rem] text-xs"
                                />
                              ) : (
                                <span className="text-muted-foreground">
                                  {column.description ?? "—"}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { applyColumnDescription, applyTableDescription, cloneMetadata };
