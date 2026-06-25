import { Bug, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

interface TopBarProps {
  title: string;
  subtitle?: ReactNode;
  showMenuButton?: boolean;
  onMenuClick?: () => void;
  showDebug?: boolean;
  onToggleDebug?: () => void;
  debugOpen?: boolean;
  className?: string;
}

export function TopBar({
  title,
  subtitle,
  showMenuButton = false,
  onMenuClick,
  showDebug = true,
  onToggleDebug,
  debugOpen = false,
  className,
}: TopBarProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card/80 px-4 py-3 backdrop-blur-sm md:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {showMenuButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground md:text-base">
            {title}
          </h1>
          {subtitle && (
            <div className="mt-0.5 min-w-0 text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onToggleDebug && showDebug && (
          <Button
            type="button"
            variant={debugOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleDebug}
            className="hidden sm:inline-flex"
          >
            <Bug className="h-3.5 w-3.5" />
            {debugOpen ? "Hide debug" : "Debug"}
          </Button>
        )}
        {onToggleDebug && showDebug && (
          <Button
            type="button"
            variant={debugOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={onToggleDebug}
            className="sm:hidden"
            aria-label={debugOpen ? "Hide debug panel" : "Show debug panel"}
          >
            <Bug className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function DbSubtitle({
  name,
  dbType,
  schemaSyncStatus,
  schemaTableCount,
  hasBusinessContext,
  activeAgentName,
  agentHasSystemPrompt,
  onConfigure,
}: {
  name?: string;
  dbType?: string;
  schemaSyncStatus?: "idle" | "syncing" | "ready" | "failed";
  schemaTableCount?: number;
  hasBusinessContext?: boolean;
  activeAgentName?: string;
  agentHasSystemPrompt?: boolean;
  onConfigure?: () => void;
}) {
  if (name && dbType) {
    const metaParts: string[] = [];
    if (schemaSyncStatus === "ready" && (schemaTableCount ?? 0) > 0) {
      metaParts.push(`${schemaTableCount} tables`);
    } else if (schemaSyncStatus === "syncing") {
      metaParts.push("syncing schema");
    } else if (schemaSyncStatus === "failed") {
      metaParts.push("schema sync failed");
    }
    if (hasBusinessContext) {
      metaParts.push("context set");
    }
    if (activeAgentName) {
      metaParts.push(
        agentHasSystemPrompt
          ? `agent: ${activeAgentName}`
          : `agent: ${activeAgentName} (default prompt)`,
      );
    }

    return (
      <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="truncate">
          {name} ({dbType})
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-success"
          title="Database connected"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_var(--color-success)]"
            aria-hidden
          />
          <span className="text-[10px] font-medium uppercase tracking-wide">Live</span>
        </span>
        {metaParts.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            · {metaParts.join(" · ")}
          </span>
        )}
      </span>
    );
  }

  if (onConfigure) {
    return (
      <button
        type="button"
        onClick={onConfigure}
        className="text-primary transition-colors duration-150 hover:underline focus-ring rounded-sm"
      >
        Configure database in Settings →
      </button>
    );
  }

  return null;
}
