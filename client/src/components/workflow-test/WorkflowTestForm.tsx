import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { UserAgent, UserDatabase, WorkflowTestGroupRecord } from "../../api";
import { providerLabel } from "../../lib/llmProviders";
import {
  countQueriesInGroups,
  parseQueries,
  type StressTestGroupInput,
} from "../../lib/parseQueryGroups";
import {
  CATEGORY_TYPES,
  CATEGORY_TYPE_LABELS,
  EXPECTED_OUTCOME_LABELS,
  resolveExecution,
  type ExecutionPolicyOverrides,
  type WorkflowTestCategoryType,
} from "../../lib/workflowTestCategory";
import {
  applyExecutionToAllGroups,
  applyExecutionToFailuresGroup,
  buildGlobalExecutionPatch,
  clearAllGroupExecutions,
  clearFailuresGroupExecution,
  EMPTY_GLOBAL_EXECUTION_DRAFT,
  type GlobalExecutionDraft,
} from "../../lib/applyGlobalExecutionOverrides";
import {
  groupFailureQueriesBySource,
  isEphemeralFailuresGroup,
} from "../../lib/workflowTestGroups";
import { DEFAULT_AVG_QUERY_MS, estimateTotalMs, formatDurationEstimate } from "../../lib/workflowTestEta";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { WorkflowTestExecutionOverridesFields } from "./WorkflowTestExecutionOverridesFields";

interface Props {
  testName: string;
  onTestNameChange: (value: string) => void;
  groups: StressTestGroupInput[];
  onGroupsChange: (groups: StressTestGroupInput[]) => void;
  agents: UserAgent[];
  agentProfileId: string | null;
  onAgentProfileIdChange: (value: string | null) => void;
  databases: UserDatabase[];
  databaseConnectionId: string | null;
  onDatabaseConnectionIdChange: (value: string | null) => void;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  delayMs: number;
  onDelayMsChange: (value: number) => void;
  failuresGroup?: WorkflowTestGroupRecord | null;
  onFailuresGroupChange?: (group: WorkflowTestGroupRecord | null) => void;
  onRunFailures?: () => void;
  disabled?: boolean;
}

function emptyGroup(): StressTestGroupInput {
  return { name: "", queriesText: "", categoryType: "STANDARD" };
}

function policySummary(group: StressTestGroupInput): string {
  const policy = resolveExecution(group.categoryType, group.execution);
  const parts = [
    policy.history === "KEEP" ? "keeps history" : "resets history",
    `expects ${EXPECTED_OUTCOME_LABELS[policy.expectedOutcome].toLowerCase()}`,
  ];
  if (policy.timeoutMs !== undefined) parts.push(`${policy.timeoutMs}ms timeout`);
  if (policy.stopOnFailure) parts.push("stops on failure");
  return parts.join(" · ");
}

export function WorkflowTestForm({
  testName,
  onTestNameChange,
  groups,
  onGroupsChange,
  agents,
  agentProfileId,
  onAgentProfileIdChange,
  databases,
  databaseConnectionId,
  onDatabaseConnectionIdChange,
  dryRun,
  onDryRunChange,
  delayMs,
  onDelayMsChange,
  failuresGroup,
  onFailuresGroupChange,
  onRunFailures,
  disabled,
}: Props) {
  const [expandedOverrides, setExpandedOverrides] = useState<Set<number>>(new Set());
  const [failuresOverridesOpen, setFailuresOverridesOpen] = useState(false);
  const [globalOverridesOpen, setGlobalOverridesOpen] = useState(false);
  const [globalDraft, setGlobalDraft] = useState<GlobalExecutionDraft>(
    EMPTY_GLOBAL_EXECUTION_DRAFT,
  );
  const totalQueries = countQueriesInGroups(groups);
  const failureSourceGroups = useMemo(
    () => groupFailureQueriesBySource(failuresGroup),
    [failuresGroup],
  );
  const globalPatch = buildGlobalExecutionPatch(globalDraft);
  const standardDefaults = resolveExecution("STANDARD");
  const hasAnyGroups = groups.length > 0 || Boolean(failuresGroup);
  const estimatedMs = estimateTotalMs({
    queryCount: totalQueries,
    avgQueryMs: DEFAULT_AVG_QUERY_MS,
    delayMs,
  });

  function updateGroup(index: number, patch: Partial<StressTestGroupInput>) {
    onGroupsChange(
      groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
  }

  function updateExecution(index: number, patch: ExecutionPolicyOverrides) {
    const group = groups[index]!;
    const nextExecution: ExecutionPolicyOverrides = { ...group.execution, ...patch };
    updateGroup(index, { execution: nextExecution });
  }

  function toggleOverrides(index: number) {
    setExpandedOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function handleApplyGlobalOverrides() {
    const patch = buildGlobalExecutionPatch(globalDraft);
    if (!patch) return;
    if (groups.length > 0) {
      onGroupsChange(applyExecutionToAllGroups(groups, patch));
    }
    if (failuresGroup && onFailuresGroupChange) {
      onFailuresGroupChange(applyExecutionToFailuresGroup(failuresGroup, patch));
    }
  }

  function handleClearAllGroupOverrides() {
    if (groups.length > 0) {
      onGroupsChange(clearAllGroupExecutions(groups));
    }
    if (failuresGroup && onFailuresGroupChange) {
      onFailuresGroupChange(clearFailuresGroupExecution(failuresGroup));
    }
  }

  function updateFailuresExecution(patch: ExecutionPolicyOverrides) {
    if (!failuresGroup || !onFailuresGroupChange) return;
    onFailuresGroupChange({
      ...failuresGroup,
      executionOverrides: {
        ...(failuresGroup.executionOverrides ?? {}),
        ...patch,
      },
    });
  }

  function updateFailuresCategory(categoryType: WorkflowTestCategoryType) {
    if (!failuresGroup || !onFailuresGroupChange) return;
    onFailuresGroupChange({ ...failuresGroup, categoryType });
  }

  function globalDraftAsExecution(): ExecutionPolicyOverrides {
    return {
      ...(globalDraft.history ? { history: globalDraft.history } : {}),
      ...(globalDraft.expectedOutcome
        ? { expectedOutcome: globalDraft.expectedOutcome }
        : {}),
      ...(globalDraft.timeoutMs.trim() !== ""
        ? { timeoutMs: Number(globalDraft.timeoutMs) }
        : {}),
    };
  }

  function updateGlobalDraftFromExecution(patch: ExecutionPolicyOverrides) {
    setGlobalDraft((prev) => {
      const next = { ...prev };
      if ("history" in patch) {
        next.history =
          patch.history === "RESET" || patch.history === "KEEP" ? patch.history : "";
      }
      if ("expectedOutcome" in patch) {
        next.expectedOutcome = patch.expectedOutcome ?? "";
      }
      if ("timeoutMs" in patch) {
        next.timeoutMs =
          patch.timeoutMs !== undefined ? String(patch.timeoutMs) : "";
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <FormField>
        <Label htmlFor="workflow-test-name">Test name</Label>
        <Input
          id="workflow-test-name"
          value={testName}
          onChange={(e) => onTestNameChange(e.target.value)}
          placeholder="e.g. Q1 regression — sales queries"
          disabled={disabled}
          required
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField>
          <Label htmlFor="workflow-test-agent">Agent</Label>
          <Select
            id="workflow-test-agent"
            value={agentProfileId ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onAgentProfileIdChange(e.target.value ? e.target.value : null)
            }
          >
            <option value="" disabled>
              Select an agent…
            </option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({providerLabel(agent.llmProvider)}
                {agent.modelName ? ` · ${agent.modelName}` : ""})
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Required. This test always runs with the selected agent profile.
          </p>
        </FormField>

        <FormField>
          <Label htmlFor="workflow-test-database">Database</Label>
          <Select
            id="workflow-test-database"
            value={databaseConnectionId ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onDatabaseConnectionIdChange(e.target.value ? e.target.value : null)
            }
          >
            <option value="">Active database (default)</option>
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name} ({db.dbType})
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional. Pins this test to a specific connection instead of your active database.
          </p>
        </FormField>
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <button
          type="button"
          onClick={() => setGlobalOverridesOpen((open) => !open)}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground focus-ring rounded-sm"
        >
          {globalOverridesOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Global execution overrides
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Set values here, then click <strong>Apply to all groups</strong>. Applies to
          manual groups and the Failures section. Per-group advanced overrides can still
          be adjusted individually afterward.
        </p>

        {globalOverridesOpen && (
          <div className="mt-4 space-y-4">
            <WorkflowTestExecutionOverridesFields
              mode="global"
              idPrefix="global-execution"
              disabled={disabled}
              resolvedDefaults={standardDefaults}
              value={globalDraftAsExecution()}
              onChange={updateGlobalDraftFromExecution}
              stopOnFailureDraft={{
                enabled: globalDraft.stopOnFailureEnabled,
                value: globalDraft.stopOnFailureValue,
              }}
              onStopOnFailureDraftChange={(draft) =>
                setGlobalDraft((prev) => ({
                  ...prev,
                  stopOnFailureEnabled: draft.enabled,
                  stopOnFailureValue: draft.value,
                }))
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled || !globalPatch || !hasAnyGroups}
                onClick={handleApplyGlobalOverrides}
              >
                Apply to all groups
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || !hasAnyGroups}
                onClick={handleClearAllGroupOverrides}
              >
                Clear all group overrides
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Query groups</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              One query per line or comma-separated within each group.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => onGroupsChange([...groups, emptyGroup()])}
          >
            <Plus className="h-4 w-4" />
            Add group
          </Button>
        </div>

        {groups.map((group, index) => {
          const queryCount = parseQueries(group.queriesText).length;
          const overridesOpen = expandedOverrides.has(index);
          const policy = resolveExecution(group.categoryType, group.execution);

          return (
            <div
              key={index}
              className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
            >
              <div className="flex items-start gap-3">
                <FormField className="flex-1">
                  <Label htmlFor={`group-name-${index}`}>Group name</Label>
                  <Input
                    id={`group-name-${index}`}
                    value={group.name}
                    onChange={(e) => updateGroup(index, { name: e.target.value })}
                    placeholder="e.g. Aggregations"
                    disabled={disabled}
                  />
                </FormField>
                <FormField className="w-48 shrink-0">
                  <Label htmlFor={`group-category-${index}`}>Category</Label>
                  <Select
                    id={`group-category-${index}`}
                    value={group.categoryType ?? "STANDARD"}
                    disabled={disabled}
                    onChange={(e) =>
                      updateGroup(index, {
                        categoryType: e.target.value as StressTestGroupInput["categoryType"],
                      })
                    }
                  >
                    {CATEGORY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {CATEGORY_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {groups.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-7 shrink-0"
                    aria-label={`Remove group ${group.name || index + 1}`}
                    disabled={disabled}
                    onClick={() =>
                      onGroupsChange(groups.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">{policySummary(group)}</p>

              <FormField>
                <Label htmlFor={`group-queries-${index}`}>
                  Queries
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({queryCount} parsed)
                  </span>
                </Label>
                <Textarea
                  id={`group-queries-${index}`}
                  value={group.queriesText}
                  onChange={(e) =>
                    updateGroup(index, { queriesText: e.target.value })
                  }
                  placeholder={"Show total revenue by month\nList top 10 customers"}
                  className="min-h-[120px] font-mono text-xs"
                  disabled={disabled}
                />
              </FormField>

              <div className="border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={() => toggleOverrides(index)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm"
                >
                  {overridesOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Advanced overrides
                </button>

                {overridesOpen && (
                  <div className="mt-3">
                    <WorkflowTestExecutionOverridesFields
                      mode="group"
                      idPrefix={`group-${index}`}
                      disabled={disabled}
                      resolvedDefaults={policy}
                      value={group.execution ?? {}}
                      onChange={(patch) => updateExecution(index, patch)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {failuresGroup && (
        <div className="space-y-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="mb-0">{failuresGroup.name}</Label>
              <Badge variant="destructive" className="normal-case">
                Failures
              </Badge>
              <span className="text-xs text-muted-foreground">
                {failuresGroup.queries.length}{" "}
                {failuresGroup.queries.length === 1 ? "query" : "queries"}
              </span>
            </div>
            {onRunFailures && failuresGroup.queries.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={onRunFailures}
              >
                <RotateCcw className="h-4 w-4" />
                Run failures
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isEphemeralFailuresGroup(failuresGroup)
              ? "Loaded from the current report (not saved to a group). Run failures updates that same report. Use Save failures to group on the Report tab to persist them."
              : "Saved from failed runs, grouped by original source group. Run failures stays on the linked report when available."}
          </p>
          {onFailuresGroupChange && (
            <div className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3">
              <FormField className="mb-0 w-48">
                <Label htmlFor="failures-category">Category</Label>
                <Select
                  id="failures-category"
                  value={failuresGroup.categoryType ?? "STANDARD"}
                  disabled={disabled}
                  onChange={(e) =>
                    updateFailuresCategory(e.target.value as WorkflowTestCategoryType)
                  }
                >
                  {CATEGORY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CATEGORY_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <button
                type="button"
                onClick={() => setFailuresOverridesOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm"
              >
                {failuresOverridesOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Advanced overrides
              </button>
              {failuresOverridesOpen && (
                <WorkflowTestExecutionOverridesFields
                  mode="group"
                  idPrefix="failures-execution"
                  disabled={disabled}
                  resolvedDefaults={resolveExecution(
                    failuresGroup.categoryType,
                    failuresGroup.executionOverrides,
                  )}
                  value={failuresGroup.executionOverrides ?? {}}
                  onChange={updateFailuresExecution}
                />
              )}
            </div>
          )}
          {failuresGroup.queries.length > 0 ? (
            <div className="space-y-3">
              {failureSourceGroups.map((source) => (
                <div key={source.sourceGroupName} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    From {source.sourceGroupName} ({source.queries.length})
                  </p>
                  <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {source.queries.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No failed queries saved yet.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => onDryRunChange(e.target.checked)}
            disabled={disabled}
            className="rounded border-input"
          />
          Dry run (skip SQL execution)
        </label>

        <FormField className="mb-0 w-auto">
          <Label htmlFor="workflow-delay">Delay between queries (ms)</Label>
          <Input
            id="workflow-delay"
            type="number"
            min={0}
            step={100}
            value={delayMs}
            onChange={(e) => onDelayMsChange(Number(e.target.value) || 0)}
            className="w-28"
            disabled={disabled}
          />
        </FormField>

        <p className="text-sm text-muted-foreground">
          Total:{" "}
          <span className="font-medium text-foreground">{totalQueries}</span>{" "}
          {totalQueries === 1 ? "query" : "queries"}
          {totalQueries > 0 && (
            <>
              {" "}
              · Est. run time:{" "}
              <span className="font-medium text-foreground">
                {formatDurationEstimate(estimatedMs)}
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
