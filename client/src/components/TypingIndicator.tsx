import { Bot } from "lucide-react";

interface Props {
  label?: string;
}

export function TypingIndicator({ label }: Props) {
  return (
    <div
      className="animate-fade-in flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-primary/30 bg-card/95 px-4 py-2.5 shadow-md backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={label ?? "Generating response"}
    >
      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {label ? (
        <span className="text-sm text-muted-foreground">{label}</span>
      ) : null}
      <span className="flex items-end gap-0.5 pb-0.5 text-xl leading-none text-muted-foreground">
        <span className="animate-typing-dot">.</span>
        <span className="animate-typing-dot [animation-delay:0.2s]">.</span>
        <span className="animate-typing-dot [animation-delay:0.4s]">.</span>
      </span>
    </div>
  );
}
