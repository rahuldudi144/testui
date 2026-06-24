import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatMessage } from "../api";
import type { StreamProgressState } from "../lib/agentStreamProgress";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Label } from "./ui/Label";
import { Textarea } from "./ui/Textarea";
import { MessageList } from "./MessageList";

interface Props {
  messages: ChatMessage[];
  loadingMessages?: boolean;
  onSend: (query: string, dryRun: boolean) => Promise<void>;
  sending: boolean;
  streamingContent: string;
  streamProgress?: StreamProgressState;
  dbConfigured: boolean;
  onOpenSettings?: () => void;
  onSelectDebug?: (debug: Record<string, unknown>) => void;
  selectedDebugRequestId?: string | null;
}

export function ChatWindow({
  messages,
  loadingMessages = false,
  onSend,
  sending,
  streamingContent,
  streamProgress,
  dbConfigured,
  onOpenSettings,
  onSelectDebug,
  selectedDebugRequestId,
}: Props) {
  const [query, setQuery] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [query]);

  async function submitQuery(text: string) {
    if (!text || sending || !dbConfigured) return;
    setQuery("");
    await onSend(text, dryRun);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitQuery(query.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitQuery(query.trim());
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!dbConfigured && (
        <div className="shrink-0 px-4 pt-4 md:px-6">
          <Alert variant="warning" title="Database not configured">
            Add a PostgreSQL or MySQL connection in{" "}
            {onOpenSettings ? (
              <button
                type="button"
                onClick={onOpenSettings}
                className="font-medium underline underline-offset-2 transition-colors hover:text-foreground focus-ring rounded-sm"
              >
                Settings
              </button>
            ) : (
              "Settings"
            )}{" "}
            before querying.
          </Alert>
        </div>
      )}

      <MessageList
        messages={messages}
        loading={loadingMessages}
        streamingContent={streamingContent}
        sending={sending}
        streamProgress={streamProgress}
        onExampleClick={(prompt) => {
          if (sending || !dbConfigured) return;
          setQuery(prompt);
          textareaRef.current?.focus();
        }}
        onSelectDebug={onSelectDebug}
        selectedDebugRequestId={selectedDebugRequestId}
      />

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-card/50 px-4 py-4 md:px-6"
      >
        <Card className="border-border/80 bg-card p-3 shadow-sm">
          <Textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              dbConfigured
                ? "Ask about your database…"
                : "Add a database connection first…"
            }
            rows={2}
            disabled={sending || !dbConfigured}
            className="min-h-[72px] border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-4 border-t border-border/60 pt-2">
            <Label
              htmlFor="dry-run"
              className="flex cursor-pointer items-center gap-2 text-sm font-normal text-muted-foreground"
            >
              <input
                id="dry-run"
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={sending || !dbConfigured}
                className="h-4 w-4 rounded border-input accent-primary focus-ring"
              />
              Dry run
            </Label>
            <Button
              type="submit"
              disabled={sending || !query.trim() || !dbConfigured}
              loading={sending}
              className="min-w-[100px]"
            >
              {!sending && <Send className="h-3.5 w-3.5" />}
              {sending ? "Generating…" : "Send"}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
