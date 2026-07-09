import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  History,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  deleteWorkflowTest,
  duplicateWorkflowTest,
  getWorkflowTest,
  getWorkflowTestRun,
  listAgents,
  listWorkflowTests,
  type SavedWorkflowTest,
  type UserAgent,
  type WorkflowTestCompletePayload,
  type WorkflowTestGroupRecord,
} from "../../api";
import { useWorkflowTestRunner } from "../../context/WorkflowTestRunnerContext";
import { providerLabel } from "../../lib/llmProviders";
import { getFailuresGroup, groupsToFormInput } from "../../lib/workflowTestGroups";
import type { StressTestGroupInput } from "../../lib/parseQueryGroups";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";

interface Props {
  disabled?: boolean;
  refreshToken?: number;
  onLoadTest: (data: {
    testName: string;
    groups: StressTestGroupInput[];
    failuresGroup: WorkflowTestGroupRecord | null;
    dryRun: boolean;
    delayMs: number;
    agentProfileId?: string | null;
  }) => void;
  onLoadReport: (report: WorkflowTestCompletePayload) => void;
  onError: (message: string) => void;
  onTestsLoaded?: (count: number) => void;
}

function formatSummary(summary: {
  passed: number;
  failed: number;
  errors: number;
  executionCount?: number;
  totalTokens?: number;
}): string {
  const base = `${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors`;
  const extras: string[] = [];
  if (summary.executionCount !== undefined) {
    extras.push(`${summary.executionCount} executions`);
  }
  if (summary.totalTokens !== undefined) {
    extras.push(`${summary.totalTokens.toLocaleString()} tokens`);
  }
  return extras.length > 0 ? `${base} · ${extras.join(" · ")}` : base;
}

function agentBadgeLabel(test: SavedWorkflowTest): string {
  if (test.agent) {
    const provider = providerLabel(test.agent.llmProvider);
    const model = test.agent.modelName ? ` · ${test.agent.modelName}` : "";
    return `${test.agent.name} (${provider}${model})`;
  }
  return "Active agent";
}

interface SuiteGroup {
  suiteKey: string;
  label: string;
  tests: SavedWorkflowTest[];
}

function groupTestsBySuite(tests: SavedWorkflowTest[]): SuiteGroup[] {
  const map = new Map<string, SavedWorkflowTest[]>();
  for (const test of tests) {
    const key = test.suiteKey ?? test.id;
    const group = map.get(key) ?? [];
    group.push(test);
    map.set(key, group);
  }

  return [...map.entries()].map(([suiteKey, suiteTests]) => {
    const sharedName = suiteTests[0]?.name.split(" — ")[0] ?? suiteTests[0]?.name ?? "Suite";
    const label =
      suiteTests.length > 1
        ? `Suite: ${sharedName} (${suiteTests.length} agents)`
        : suiteTests[0]?.name ?? "Test";
    return { suiteKey, label, tests: suiteTests };
  });
}

export function WorkflowTestSavedPanel({
  disabled,
  refreshToken,
  onLoadTest,
  onLoadReport,
  onError,
  onTestsLoaded,
}: Props) {
  const [tests, setTests] = useState<SavedWorkflowTest[]>([]);
  const [agents, setAgents] = useState<UserAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, Awaited<ReturnType<typeof getWorkflowTest>>>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedWorkflowTest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<SavedWorkflowTest | null>(null);
  const [duplicateAgentId, setDuplicateAgentId] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const { run, runGroup, running: runnerActive } = useWorkflowTestRunner();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, agentList] = await Promise.all([
        listWorkflowTests(),
        listAgents().catch(() => ({ agents: [] as UserAgent[], activeAgentId: null })),
      ]);
      setTests(list);
      setAgents(agentList.agents);
      onTestsLoaded?.(list.length);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load saved tests.");
    } finally {
      setLoading(false);
    }
  }, [onError, onTestsLoaded]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    if (!expandedId) return;

    let cancelled = false;
    void (async () => {
      setLoadingDetailId(expandedId);
      try {
        const detail = await getWorkflowTest(expandedId);
        if (!cancelled) {
          setDetailById((prev) => ({ ...prev, [expandedId]: detail }));
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to refresh run history.");
        }
      } finally {
        if (!cancelled) setLoadingDetailId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expandedId, refreshToken, onError]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tests;
    return tests.filter(
      (test) =>
        test.name.toLowerCase().includes(query) ||
        test.agent?.name.toLowerCase().includes(query),
    );
  }, [search, tests]);

  const suiteGroups = useMemo(() => groupTestsBySuite(filtered), [filtered]);

  async function handleLoadTest(test: SavedWorkflowTest) {
    onLoadTest({
      testName: test.name,
      groups: groupsToFormInput(test.groups),
      failuresGroup: getFailuresGroup(test.groups) ?? null,
      dryRun: test.dryRun,
      delayMs: test.delayMs,
      agentProfileId: test.agentProfileId,
    });
  }

  async function handleRerun(test: SavedWorkflowTest) {
    if (!test.agentProfileId) {
      onError("Assign an agent to this saved test in Setup before running.");
      return;
    }

    const manualGroups = test.groups
      .filter((group) => group.kind === "manual")
      .map((group) => ({ name: group.name, queries: group.queries }));

    await run({
      testName: test.name,
      groups: manualGroups,
      agentProfileId: test.agentProfileId,
      dryRun: test.dryRun,
      delayMs: test.delayMs,
    });
  }

  async function handleRunFailures(test: SavedWorkflowTest) {
    const failures = getFailuresGroup(test.groups);
    if (!failures || failures.queries.length === 0) return;

    await runGroup(test.id, failures.id, {
      testName: test.name,
      dryRun: test.dryRun,
      delayMs: test.delayMs,
    });
  }

  async function handleLoadRun(runId: string) {
    setLoadingRunId(runId);
    try {
      const report = await getWorkflowTestRun(runId);
      onLoadReport(report);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load run report.");
    } finally {
      setLoadingRunId(null);
    }
  }

  async function toggleExpanded(test: SavedWorkflowTest) {
    if (expandedId === test.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(test.id);

    if (detailById[test.id]) return;

    setLoadingDetailId(test.id);
    try {
      const detail = await getWorkflowTest(test.id);
      setDetailById((prev) => ({ ...prev, [test.id]: detail }));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load run history.");
      setExpandedId(null);
    } finally {
      setLoadingDetailId(null);
    }
  }

  function openDuplicateDialog(test: SavedWorkflowTest) {
    const otherAgents = agents.filter((agent) => agent.id !== test.agentProfileId);
    setDuplicateTarget(test);
    setDuplicateAgentId(otherAgents[0]?.id ?? "");
    const baseName = test.name.split(" — ")[0] ?? test.name;
    const agentName = otherAgents[0]?.name ?? "Agent";
    setDuplicateName(`${baseName} — ${agentName}`);
  }

  async function confirmDuplicate() {
    if (!duplicateTarget || !duplicateAgentId) return;
    setDuplicating(true);
    try {
      await duplicateWorkflowTest(duplicateTarget.id, {
        agentProfileId: duplicateAgentId,
        testName: duplicateName.trim() || undefined,
      });
      setDuplicateTarget(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to duplicate test.");
    } finally {
      setDuplicating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWorkflowTest(deleteTarget.id);
      if (expandedId === deleteTarget.id) setExpandedId(null);
      setDetailById((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete test.");
    } finally {
      setDeleting(false);
    }
  }

  function renderTestCard(test: SavedWorkflowTest) {
    const summary = test.lastRun?.summary;
    const expanded = expandedId === test.id;
    const detail = detailById[test.id];
    const runs = detail?.runs ?? [];
    const failures = getFailuresGroup(test.groups);
    const failuresCount = failures?.queries.length ?? 0;
    const canDuplicate = agents.some((agent) => agent.id !== test.agentProfileId);
    const hasAgent = Boolean(test.agentProfileId);

    return (
      <div
        key={test.id}
        className="overflow-hidden rounded-lg border border-border bg-card/40"
      >
        <div className="p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => void toggleExpanded(test)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left focus-ring rounded-md"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{test.name}</span>
                  <Badge variant="outline" className="normal-case">
                    {agentBadgeLabel(test)}
                  </Badge>
                  {test.dryRun && (
                    <Badge variant="outline" className="normal-case">
                      dry run
                    </Badge>
                  )}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {test.groups.filter((g) => g.kind === "manual").length} manual
                  group(s) · {failuresCount} failure
                  {failuresCount === 1 ? "" : "s"} · {test.runCount} run(s)
                  {test.lastRun && (
                    <>
                      {" "}
                      · last run {new Date(test.lastRun.ranAt).toLocaleString()}
                    </>
                  )}
                </span>
                {summary && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Last: {formatSummary(summary)}
                  </span>
                )}
                {!hasAgent && (
                  <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                    No agent assigned — open in Setup and select an agent before running.
                  </span>
                )}
              </span>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled || runnerActive || !hasAgent}
                onClick={() => void handleRerun(test)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Run all
              </Button>
              {failuresCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled || runnerActive || !hasAgent}
                  onClick={() => void handleRunFailures(test)}
                >
                  Run failures
                </Button>
              )}
              {canDuplicate && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => openDuplicateDialog(test)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate for agent
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() => void handleLoadTest(test)}
              >
                Load setup
              </Button>
              {test.lastRun && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled || loadingRunId === test.lastRun.id}
                  loading={loadingRunId === test.lastRun.id}
                  onClick={() => void handleLoadRun(test.lastRun!.id)}
                >
                  Last report
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Delete ${test.name}`}
                onClick={() => setDeleteTarget(test)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border bg-muted/10 px-3 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Run history
            </p>
            {loadingDetailId === test.id ? (
              <p className="text-xs text-muted-foreground">Loading runs…</p>
            ) : runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No runs recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {runs.map((runItem) => (
                  <div
                    key={runItem.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2",
                    )}
                  >
                    <div className="min-w-0 text-xs">
                      <p className="font-medium text-foreground">
                        {new Date(runItem.ranAt).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {formatSummary(runItem.summary)}
                        {runItem.dryRun ? " · dry run" : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || loadingRunId === runItem.id}
                      loading={loadingRunId === runItem.id}
                      onClick={() => void handleLoadRun(runItem.id)}
                    >
                      View report
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">All workflow tests</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : `${tests.length} saved test${tests.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search tests…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label="Search workflow tests"
            disabled={loading}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading saved tests…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title={search ? "No matching tests" : "No saved tests yet"}
          description={
            search
              ? `No tests match "${search}".`
              : "Run a workflow test from Setup to save its definition and reports."
          }
          className="py-8"
        />
      ) : (
        <div className="space-y-4">
          {suiteGroups.map((suite) => (
            <div key={suite.suiteKey} className="space-y-2">
              {suite.tests.length > 1 && (
                <p className="text-xs font-medium text-muted-foreground">{suite.label}</p>
              )}
              <div className="space-y-2">
                {suite.tests.map((test) => renderTestCard(test))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete saved workflow test?"
        description={`"${deleteTarget?.name ?? "Test"}" and all of its run history will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />

      <Dialog
        open={!!duplicateTarget}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate for another agent</DialogTitle>
            <DialogDescription>
              Copy this test&apos;s manual query groups into a new saved test pinned to a
              different agent. The suite key is preserved for Compare.
            </DialogDescription>
          </DialogHeader>
          {duplicateTarget && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="duplicate-agent">Agent</Label>
                <select
                  id="duplicate-agent"
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={duplicateAgentId}
                  onChange={(e) => {
                    const agent = agents.find((item) => item.id === e.target.value);
                    setDuplicateAgentId(e.target.value);
                    if (agent) {
                      const baseName =
                        duplicateTarget.name.split(" — ")[0] ?? duplicateTarget.name;
                      setDuplicateName(`${baseName} — ${agent.name}`);
                    }
                  }}
                >
                  {agents
                    .filter((agent) => agent.id !== duplicateTarget.agentProfileId)
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} ({providerLabel(agent.llmProvider)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label htmlFor="duplicate-name">Test name</Label>
                <Input
                  id="duplicate-name"
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDuplicateTarget(null)}
              disabled={duplicating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={duplicating}
              disabled={!duplicateAgentId}
              onClick={() => void confirmDuplicate()}
            >
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
