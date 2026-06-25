import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentEvent } from "../../types/agentEvents";
import { nodeStreamLabel } from "../../lib/agentStreamLabels";
import type { GraphNodeName } from "../../types/agentEvents";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  events: AgentEvent[];
  showTokens?: boolean;
  className?: string;
}

function eventBadgeVariant(
  type: AgentEvent["type"],
): "default" | "success" | "warning" | "destructive" | "info" | "outline" {
  switch (type) {
    case "node_start":
      return "info";
    case "node_complete":
      return "success";
    case "validation_failed":
    case "error":
      return "destructive";
    case "query_executed":
    case "answer_verification":
      return "default";
    case "token":
      return "outline";
    case "llm_usage":
      return "info";
    default:
      return "outline";
  }
}

function formatEventSummary(event: AgentEvent): string {
  switch (event.type) {
    case "node_start":
    case "node_complete":
      return nodeStreamLabel(event.node as GraphNodeName);
    case "validation_failed":
      return `${event.errors.length} error${event.errors.length === 1 ? "" : "s"}`;
    case "query_executed":
      return `${event.rowCount} rows`;
    case "answer_verification":
      return event.answered ? "satisfied" : "not satisfied";
    case "sql_generated":
      return `${event.sql.length} chars`;
    case "token":
      return `${event.content.length} chars`;
    case "llm_usage": {
      const parts: string[] = [nodeStreamLabel(event.node as GraphNodeName)];
      if (event.promptTokens !== undefined) parts.push(`${event.promptTokens} prompt`);
      if (event.completionTokens !== undefined) {
        parts.push(`${event.completionTokens} completion`);
      }
      return parts.join(" · ");
    }
    case "status":
      return event.message;
    case "debug":
      return event.name;
    case "error":
      return event.message;
    case "done": {
      const parts = ["stream finished"];
      if (event.totalTokens !== undefined) parts.push(`${event.totalTokens} total tokens`);
      return parts.join(" · ");
    }
    default:
      return "";
  }
}

function EventDetail({ event }: { event: AgentEvent }) {
  if (event.type === "sql_generated") {
    return (
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-background p-2 font-mono text-[10px]">
        {event.sql}
      </pre>
    );
  }
  if (event.type === "validation_failed") {
    return (
      <ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
        {event.errors.map((err) => (
          <li key={err}>{err}</li>
        ))}
      </ul>
    );
  }
  if (event.type === "token") {
    return (
      <pre className="mt-1 max-h-24 overflow-auto rounded-md bg-background p-2 font-mono text-[10px] text-muted-foreground">
        {event.content}
      </pre>
    );
  }
  if (event.type === "debug") {
    return (
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-background p-2 font-mono text-[10px]">
        {JSON.stringify(event.data, null, 2)}
      </pre>
    );
  }
  if (event.type === "node_complete") {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        Duration: {event.durationMs} ms
      </p>
    );
  }
  if (event.type === "llm_usage") {
    return (
      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        <p>
          {event.provider} / {event.model}
        </p>
        {event.promptTokens !== undefined && <p>Prompt tokens: {event.promptTokens}</p>}
        {event.completionTokens !== undefined && (
          <p>Completion tokens: {event.completionTokens}</p>
        )}
        {event.totalTokens !== undefined && <p>Total tokens: {event.totalTokens}</p>}
      </div>
    );
  }
  if (event.type === "done") {
    const hasTotals =
      event.totalPromptTokens !== undefined ||
      event.totalCompletionTokens !== undefined ||
      event.totalTokens !== undefined;
    if (!hasTotals) return null;
    return (
      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        {event.totalPromptTokens !== undefined && (
          <p>Total prompt tokens: {event.totalPromptTokens}</p>
        )}
        {event.totalCompletionTokens !== undefined && (
          <p>Total completion tokens: {event.totalCompletionTokens}</p>
        )}
        {event.totalTokens !== undefined && <p>Total tokens: {event.totalTokens}</p>}
      </div>
    );
  }
  return null;
}

function hasExpandableDetail(event: AgentEvent): boolean {
  return (
    event.type === "sql_generated" ||
    event.type === "validation_failed" ||
    event.type === "token" ||
    event.type === "debug" ||
    event.type === "node_complete" ||
    event.type === "llm_usage" ||
    event.type === "done"
  );
}

export function StreamEventsView({
  events,
  showTokens: showTokensDefault = false,
  className,
}: Props) {
  const [showTokens, setShowTokens] = useState(showTokensDefault);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const visibleEvents = useMemo(
    () => (showTokens ? events : events.filter((e) => e.type !== "token")),
    [events, showTokens],
  );

  const tokenCount = useMemo(
    () => events.filter((e) => e.type === "token").length,
    [events],
  );

  function toggleExpanded(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  if (events.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        No stream events captured yet.
      </p>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {tokenCount > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            {events.length} events · {tokenCount} tokens hidden
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowTokens((v) => !v)}
          >
            {showTokens ? "Hide tokens" : "Show tokens"}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {visibleEvents.map((event, index) => {
          const expandable = hasExpandableDetail(event);
          const isOpen = expanded.has(index);

          return (
            <div
              key={`${event.type}-${index}`}
              className="rounded-md border border-border bg-background px-2.5 py-2"
            >
              <div className="flex items-start gap-2">
                {expandable ? (
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 text-muted-foreground focus-ring rounded-sm"
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(index)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="w-3.5 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={eventBadgeVariant(event.type)} className="normal-case">
                      {event.type}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      #{index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {formatEventSummary(event)}
                    </span>
                  </div>
                  {expandable && isOpen && <EventDetail event={event} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
