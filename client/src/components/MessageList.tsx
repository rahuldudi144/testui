import { useEffect, useRef } from "react";
import { Bot, MessageSquare } from "lucide-react";
import type { ChatMessage } from "../api";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { MarkdownContent } from "./ui/MarkdownContent";
import { Skeleton } from "./ui/Skeleton";
import { AgentStreamProgress } from "./AgentStreamProgress";
import {
  shouldShowStreamProgress,
  type StreamProgressState,
} from "../lib/agentStreamProgress";
import { TypingIndicator } from "./TypingIndicator";

const EXAMPLE_PROMPTS = [
  "Show top 10 customers",
  "List recent orders",
  "Revenue by month",
  "Most active users",
];

interface Props {
  messages: ChatMessage[];
  loading?: boolean;
  streamingContent?: string;
  sending?: boolean;
  streamProgress?: StreamProgressState;
  onExampleClick?: (prompt: string) => void;
  onSelectDebug?: (debug: Record<string, unknown>) => void;
  selectedDebugRequestId?: string | null;
}

export function MessageList({
  messages,
  loading = false,
  streamingContent,
  sending = false,
  streamProgress,
  onExampleClick,
  onSelectDebug,
  selectedDebugRequestId,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    if (!stickToBottomRef.current && !sending && !streamingContent) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: sending || streamingContent ? "auto" : "smooth",
    });
  }, [messages, streamingContent, loading, sending, streamProgress]);

  const showProgress =
    sending && shouldShowStreamProgress(streamProgress) && !streamingContent;

  const waitingForAnswerStream =
    sending &&
    !streamingContent &&
    streamProgress &&
    !streamProgress.showProgress;

  const showFallbackTyping =
    sending && !streamingContent && !showProgress && !waitingForAnswerStream;

  const showEmptyState = messages.length === 0 && !sending && !streamingContent;

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 md:px-6"
    >
      {loading ? (
        <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="ml-auto h-20 w-2/3 max-w-md rounded-2xl" />
          <Skeleton className="h-28 w-2/3 max-w-lg rounded-2xl" />
          <Skeleton className="ml-auto h-16 w-1/2 max-w-sm rounded-2xl" />
        </div>
      ) : showEmptyState ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyState
            icon={MessageSquare}
            title="Start a conversation with your SQL Agent"
            description="Ask natural-language questions. The agent generates safe read-only SQL and returns results as markdown."
            action={
              onExampleClick && (
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onExampleClick(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              )
            }
            className="py-12"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const debugData =
              msg.debugData && typeof msg.debugData === "object"
                ? (msg.debugData as Record<string, unknown>)
                : null;
            const debugRequestId =
              debugData && typeof debugData.requestId === "string"
                ? debugData.requestId
                : null;
            const debugSelected =
              debugRequestId !== null &&
              debugRequestId === selectedDebugRequestId;

            return (
              <article
                key={msg.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[min(760px,88%)] rounded-2xl border px-4 py-3",
                    isUser
                      ? "rounded-br-md border-primary/30 bg-primary/15"
                      : "rounded-bl-md border-border bg-card",
                    debugSelected && "ring-2 ring-primary/35",
                  )}
                >
                  {!isUser && (
                    <header className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">SQL Agent</span>
                      </div>
                      {debugData && onSelectDebug && (
                        <Button
                          type="button"
                          variant={debugSelected ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
                          aria-pressed={debugSelected}
                          onClick={() => onSelectDebug(debugData)}
                        >
                          Debug
                        </Button>
                      )}
                    </header>
                  )}

                  <div className="min-w-0">
                    {isUser ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {msg.content}
                      </p>
                    ) : (
                      <MarkdownContent content={msg.content} />
                    )}
                  </div>

                  {msg.generatedSql && (
                    <Card className="mt-3 border-border/60 bg-background/50">
                      <CardHeader className="p-3 pb-0">
                        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Generated SQL
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 pt-2">
                        <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
                          <code>{msg.generatedSql}</code>
                        </pre>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </article>
            );
          })}

          {showProgress && streamProgress && (
            <article className="flex justify-start">
              <AgentStreamProgress progress={streamProgress} />
            </article>
          )}

          {sending && streamingContent && (
            <article className="flex justify-start">
              <div className="max-w-[min(760px,88%)] rounded-2xl rounded-bl-md border border-primary/40 bg-card px-4 py-3 ring-1 ring-primary/20">
                <header className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">SQL Agent</span>
                </header>
                <div className="min-w-0" aria-live="polite" aria-busy>
                  <MarkdownContent content={streamingContent} />
                  <span className="animate-blink text-primary" aria-hidden>
                    ▍
                  </span>
                </div>
              </div>
            </article>
          )}

          {showFallbackTyping && (
            <article className="flex justify-start">
              <TypingIndicator />
            </article>
          )}
        </div>
      )}
    </div>
  );
}
