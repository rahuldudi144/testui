import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { KnowledgeDocument } from "../api";
import { cn } from "../lib/cn";
import { Badge } from "./ui/Badge";

function truncate(text: string, max = 400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function KnowledgeDocumentCard({
  document,
  defaultOpen = false,
}: {
  document: KnowledgeDocument;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        className="flex w-full items-start gap-2 p-3 text-left focus-ring rounded-md"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{document.table}</span>
          {document.summary && (
            <span className="mt-1 block text-sm text-muted-foreground line-clamp-2">
              {document.summary}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-3 pb-3 pt-2 text-sm">
          {document.summary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Summary</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {document.summary}
              </p>
            </div>
          )}

          {document.businessConcepts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Business concepts
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {document.businessConcepts.map((concept) => (
                  <Badge key={concept} variant="outline" className="normal-case">
                    {concept}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {document.aliases.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Aliases</p>
              <p className="mt-1 text-foreground">{document.aliases.join(", ")}</p>
            </div>
          )}

          {document.schema.columns.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Columns</p>
              <ul className="mt-1 space-y-1">
                {document.schema.columns.map((column) => (
                  <li key={column.name} className="text-foreground">
                    <span className="font-mono text-xs">{column.name}</span>
                    {column.type && (
                      <span className="text-muted-foreground"> · {column.type}</span>
                    )}
                    {column.description && (
                      <span className="block text-xs text-muted-foreground">
                        {column.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {document.relationships.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Relationships
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-foreground">
                {document.relationships.map((rel) => (
                  <li key={rel}>{rel}</li>
                ))}
              </ul>
            </div>
          )}

          {document.embeddingText && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Embedding text
              </p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/30 p-2 text-xs leading-relaxed whitespace-pre-wrap">
                {truncate(document.embeddingText, 1200)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  documents: KnowledgeDocument[];
  title?: string;
  className?: string;
  /** Open the first table by default (useful while indexing). */
  openLatest?: boolean;
}

export function KnowledgeDocumentView({
  documents,
  title = "Indexed knowledge",
  className,
  openLatest = false,
}: Props) {
  if (documents.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No indexed documents yet.
      </p>
    );
  }

  const sorted = [...documents].sort((a, b) => a.table.localeCompare(b.table));
  const latestTable = openLatest ? sorted[sorted.length - 1]?.table : undefined;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <span className="text-xs text-muted-foreground">
          {documents.length} table{documents.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map((document) => (
          <KnowledgeDocumentCard
            key={document.id}
            document={document}
            defaultOpen={document.table === latestTable}
          />
        ))}
      </div>
    </div>
  );
}
