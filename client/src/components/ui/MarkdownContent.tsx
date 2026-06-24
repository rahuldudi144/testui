import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";

interface MarkdownContentProps {
  content: string;
  className?: string;
  compact?: boolean;
}

function buildComponents(compact: boolean): Components {
  return {
    h1: ({ children }) => (
      <h1
        className={cn(
          "mb-2 font-semibold tracking-tight text-foreground",
          compact ? "text-base" : "text-lg",
        )}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={cn(
          "mb-2 mt-4 font-semibold tracking-tight text-foreground",
          compact ? "text-sm" : "text-base",
        )}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-sm font-semibold text-foreground">{children}</h3>
    ),
    p: ({ children }) => (
      <p className={cn("leading-relaxed text-foreground/95", compact ? "my-1.5 text-xs" : "my-2 text-sm")}>
        {children}
      </p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 transition-colors hover:text-primary/80"
      >
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul className={cn("my-2 list-disc pl-5 text-foreground/95", compact ? "text-xs" : "text-sm")}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={cn("my-2 list-decimal pl-5 text-foreground/95", compact ? "text-xs" : "text-sm")}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="my-0.5 leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-border" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[280px] border-collapse text-left">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
        {children}
      </thead>
    ),
    tbody: ({ children }) => <tbody className="divide-y divide-border/60">{children}</tbody>,
    tr: ({ children }) => <tr className="transition-colors hover:bg-muted/30">{children}</tr>,
    th: ({ children }) => (
      <th className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{children}</th>
    ),
    td: ({ children }) => (
      <td className={cn("whitespace-nowrap px-3 py-2 text-foreground/90", compact ? "text-xs" : "text-sm")}>
        {children}
      </td>
    ),
    code: ({ className, children }) => {
      const text = String(children).replace(/\n$/, "");
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      const isBlock = Boolean(language) || text.includes("\n");

      if (!isBlock) {
        return (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
            {children}
          </code>
        );
      }

      const isSql = language === "sql";

      return (
        <code
          className={cn(
            "block overflow-x-auto font-mono leading-relaxed",
            compact ? "text-[11px]" : "text-xs",
            isSql ? "text-emerald-300/90" : "text-foreground",
            className,
          )}
        >
          {text}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre
        className={cn(
          "my-3 overflow-x-auto rounded-lg border border-border bg-background p-3",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {children}
      </pre>
    ),
  };
}

export function MarkdownContent({ content, className, compact = false }: MarkdownContentProps) {
  if (!content.trim()) return null;

  return (
    <div className={cn("markdown-content min-w-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(compact)}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
