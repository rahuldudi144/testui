import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import {
  DEBUG_PANEL_RESIZE,
  SIDEBAR_RESIZE,
  useResizableWidth,
} from "../../lib/useResizableWidth";
import { ResizeHandle } from "./ResizeHandle";
import { Sheet } from "../ui/Sheet";
import { useIsDesktop, useIsTabletUp } from "../../lib/useMediaQuery";

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
  debugPanel?: ReactNode;
  showDebug?: boolean;
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  debugSheetOpen?: boolean;
  onDebugSheetOpenChange?: (open: boolean) => void;
}

export function AppShell({
  sidebar,
  main,
  debugPanel,
  showDebug = false,
  sidebarOpen = false,
  onSidebarOpenChange,
  debugSheetOpen = false,
  onDebugSheetOpenChange,
}: AppShellProps) {
  const isDesktop = useIsDesktop();
  const isTabletUp = useIsTabletUp();

  const showInlineDebug = isDesktop && showDebug && debugPanel;
  const showDebugSheet = !isDesktop && showDebug && debugPanel;
  const showInlineSidebar = isTabletUp;
  const { width: sidebarWidth, startResize: startSidebarResize } = useResizableWidth(
    showInlineSidebar,
    SIDEBAR_RESIZE,
  );
  const { width: debugWidth, startResize: startDebugResize } = useResizableWidth(
    !!showInlineDebug,
    DEBUG_PANEL_RESIZE,
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {isTabletUp ? (
        <>
          <nav
            aria-label="Conversations"
            style={{ width: sidebarWidth }}
            className="hidden h-full shrink-0 border-r border-border bg-card md:flex md:flex-col md:overflow-hidden"
          >
            {sidebar}
          </nav>
          <ResizeHandle
            label="Resize sidebar"
            onPointerDown={startSidebarResize}
            className="group relative hidden w-1 shrink-0 cursor-col-resize touch-none bg-border/40 md:block"
          />
        </>
      ) : (
        <Sheet
          open={sidebarOpen}
          onOpenChange={(open) => onSidebarOpenChange?.(open)}
          side="left"
          title="Conversations"
          description="Browse and manage your SQL agent sessions"
        >
          <nav aria-label="Conversations" className="flex h-full flex-col">
            {sidebar}
          </nav>
        </Sheet>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {main}
        </div>

        {showInlineDebug && (
          <>
            <ResizeHandle
              label="Resize debug panel"
              onPointerDown={startDebugResize}
              className="group relative hidden w-1 shrink-0 cursor-col-resize touch-none bg-border/40 xl:block"
            />
            <aside
              aria-label="Debug panel"
              style={{ width: debugWidth }}
              className="hidden h-full shrink-0 overflow-hidden border-l border-border bg-card xl:flex xl:flex-col"
            >
              {debugPanel}
            </aside>
          </>
        )}
      </div>

      {showDebugSheet && (
        <Sheet
          open={debugSheetOpen}
          onOpenChange={(open) => onDebugSheetOpenChange?.(open)}
          side="right"
          title="Agent debug"
          description="Output from the last agent run"
          className="max-w-md"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {debugPanel}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export function MainContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      id="main-content"
      className={cn("flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden animate-fade-in", className)}
    >
      {children}
    </main>
  );
}
