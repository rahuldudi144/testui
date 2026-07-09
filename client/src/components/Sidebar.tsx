import { useState } from "react";
import {
  CircleUser,
  FlaskConical,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useWorkflowTestRunner } from "../context/WorkflowTestRunnerContext";
import { LiveFlaskIcon } from "./workflow-test/LiveFlaskIcon";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EmptyState } from "./ui/EmptyState";
import { Input } from "./ui/Input";

interface Props {
  user: { username: string };
  search: string;
  onSearchChange: (value: string) => void;
  conversations: Array<{
    id: string;
    title: string | null;
    updatedAt: string;
    _count: { messages: number };
  }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenWorkflowTest: () => void;
}

function formatRelativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function Sidebar({
  user,
  search,
  onSearchChange,
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onLogout,
  onOpenSettings,
  onOpenWorkflowTest,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const {
    running: workflowTestRunning,
    testName,
    progress,
    liveResults,
  } = useWorkflowTestRunner();

  const filtered = conversations.filter((c) =>
    (c.title ?? "Untitled").toLowerCase().includes(search.toLowerCase()),
  );

  const completedCount = Math.max(progress.completedQueries, liveResults.length);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-primary to-violet-500 text-xs font-bold text-white">
          QF
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">DB Agent</p>
        </div>
      </div>

      <Button type="button" className="w-full shrink-0" onClick={onNew}>
        <MessageSquarePlus className="h-4 w-4" />
        New conversation
      </Button>

      <div className="relative shrink-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search conversations…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
          aria-label="Search conversations"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <p className="mb-1.5 shrink-0 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Conversations ({filtered.length})
        </p>
        <div
          role="listbox"
          aria-label="Conversation list"
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5"
        >
          {filtered.length === 0 ? (
            search ? (
              <EmptyState
                title="No matches"
                description={`No conversations match "${search}".`}
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onSearchChange("")}
                  >
                    Clear search
                  </Button>
                }
                className="py-6"
              />
            ) : (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                No conversations yet.
              </p>
            )
          ) : (
            filtered.map((conversation) => {
              const isActive = conversation.id === activeId;
              const title = conversation.title ?? "Untitled";

              return (
                <div
                  key={conversation.id}
                  className="group flex items-center gap-0.5 rounded-lg"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-ring",
                      isActive ? "bg-primary/10" : "hover:bg-muted/60",
                    )}
                  >
                    <MessageSquare
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {formatRelativeTime(conversation.updatedAt)} ·{" "}
                        {conversation._count?.messages ?? 0} msgs
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Delete conversation ${title}`}
                    onClick={() => setDeleteTarget({ id: conversation.id, title })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-auto shrink-0 space-y-2 border-t border-border pt-3">
        {workflowTestRunning && (
          <button
            type="button"
            onClick={onOpenWorkflowTest}
            className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10 focus-ring"
          >
            <p className="text-xs font-medium text-foreground">Workflow test running</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {testName || "Unnamed test"} · {completedCount}/
              {progress.totalQueries || "?"}
            </p>
          </button>
        )}

        <div className="flex items-center gap-2 px-1">
          <CircleUser className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={user.username}
          >
            {user.username}
          </p>
        </div>

        <div className="flex items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenWorkflowTest}
            aria-label={
              workflowTestRunning ? "Workflow test running — open" : "Workflow test"
            }
            className={cn(workflowTestRunning && "text-primary")}
            title="Workflow test"
          >
            {workflowTestRunning ? (
              <LiveFlaskIcon iconClassName="text-primary" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete conversation?"
        description={`"${deleteTarget?.title ?? "Untitled"}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
