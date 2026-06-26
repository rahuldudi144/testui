import { Plus, Trash2 } from "lucide-react";
import type { WorkflowTestGroupRecord } from "../../api";
import {
  countQueriesInGroups,
  parseQueries,
  type StressTestGroupInput,
} from "../../lib/parseQueryGroups";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";

interface Props {
  testName: string;
  onTestNameChange: (value: string) => void;
  groups: StressTestGroupInput[];
  onGroupsChange: (groups: StressTestGroupInput[]) => void;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  delayMs: number;
  onDelayMsChange: (value: number) => void;
  failuresGroup?: WorkflowTestGroupRecord | null;
  disabled?: boolean;
}

function emptyGroup(): StressTestGroupInput {
  return { name: "", queriesText: "" };
}

export function WorkflowTestForm({
  testName,
  onTestNameChange,
  groups,
  onGroupsChange,
  dryRun,
  onDryRunChange,
  delayMs,
  onDelayMsChange,
  failuresGroup,
  disabled,
}: Props) {
  const totalQueries = countQueriesInGroups(groups);

  function updateGroup(index: number, patch: Partial<StressTestGroupInput>) {
    onGroupsChange(
      groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
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
            </div>
          );
        })}
      </div>

      {failuresGroup && (
        <div className="space-y-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-4">
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
          <p className="text-xs text-muted-foreground">
            Saved from failed runs. Import failures from a report, then run this
            group separately.
          </p>
          {failuresGroup.queries.length > 0 ? (
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {failuresGroup.queries.join("\n")}
            </pre>
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
        </p>
      </div>
    </div>
  );
}
