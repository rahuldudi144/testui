import { Loader2 } from "lucide-react";
import type { StreamProgressState } from "../lib/agentStreamProgress";
import { TypingIndicator } from "./TypingIndicator";

interface Props {
  progress: StreamProgressState;
}

export function AgentStreamProgress({ progress }: Props) {
  const { currentLabel, thinking, validationWarning } = progress;

  if (thinking && !currentLabel && !validationWarning) {
    return <TypingIndicator label="Thinking" />;
  }

  if (!currentLabel && !validationWarning) {
    return null;
  }

  return (
    <div
      className="animate-fade-in flex max-w-[min(760px,88%)] flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-label="Agent progress"
    >
      {currentLabel && (
        <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-primary/30 bg-card/95 px-4 py-2.5 shadow-md backdrop-blur-sm">
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-primary"
            aria-hidden
          />
          <span className="text-sm text-foreground">{currentLabel}</span>
        </div>
      )}

      {validationWarning && (
        <p className="text-xs text-warning">{validationWarning}</p>
      )}
    </div>
  );
}
