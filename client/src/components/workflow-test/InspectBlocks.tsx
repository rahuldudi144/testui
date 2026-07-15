import type { ReactNode } from "react";
import { formatStateFieldValue } from "../debug/formatStateValue";
import { cn } from "../../lib/cn";
import { nodeStreamLabel } from "../../lib/agentStreamLabels";

export function InspectSection({
  title,
  children,
  className,
  variant = "default",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  variant?: "default" | "destructive";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        variant === "destructive"
          ? "border-destructive/30"
          : "border-border",
        className,
      )}
    >
      <div
        className={cn(
          "border-b px-3 py-2 text-xs font-medium uppercase tracking-wide",
          variant === "destructive"
            ? "border-destructive/20 bg-destructive/5 text-destructive"
            : "border-border bg-muted/30 text-muted-foreground",
        )}
      >
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export function InspectMetaGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-md border border-border/60 bg-muted/10 px-3 py-2"
        >
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InspectCodeBlock({
  value,
  language = "text",
}: {
  value: string;
  language?: string;
}) {
  return (
    <pre
      className="max-h-80 overflow-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap wrap-break-words"
      data-language={language}
    >
      {value}
    </pre>
  );
}

export function InspectStateTable({
  state,
}: {
  state: Record<string, unknown>;
}) {
  const entries = Object.entries(state);
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No state fields.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-3 py-2 font-medium text-muted-foreground">Field</th>
            <th className="px-3 py-2 font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-foreground">
                {key}
              </td>
              <td className="px-3 py-2 align-top">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-words font-mono text-[11px] text-muted-foreground">
                  {formatStateFieldValue(key, value)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkflowPathPills({ path }: { path: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {path.map((node, index) => (
        <span key={`${node}-${index}`} className="inline-flex items-center gap-1.5">
          <span
            className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-foreground"
            title={node}
          >
            {nodeStreamLabel(node)}
          </span>
          {index < path.length - 1 && (
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
