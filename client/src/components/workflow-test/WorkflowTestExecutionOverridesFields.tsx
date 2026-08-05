import {
  EXPECTED_OUTCOMES,
  EXPECTED_OUTCOME_LABELS,
  type ExecutionPolicyOverrides,
  type ResolvedExecution,
  type WorkflowExpectedOutcome,
  type WorkflowHistoryMode,
} from "../../lib/workflowTestCategory";
import { FormField } from "../ui/FormField";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Select } from "../ui/Select";

export interface GlobalStopOnFailureDraft {
  enabled: boolean;
  value: boolean;
}

interface BaseProps {
  idPrefix: string;
  disabled?: boolean;
  resolvedDefaults: ResolvedExecution;
}

interface GroupModeProps extends BaseProps {
  mode: "group";
  value: ExecutionPolicyOverrides;
  onChange: (patch: ExecutionPolicyOverrides) => void;
}

interface GlobalModeProps extends BaseProps {
  mode: "global";
  value: ExecutionPolicyOverrides;
  onChange: (patch: ExecutionPolicyOverrides) => void;
  stopOnFailureDraft: GlobalStopOnFailureDraft;
  onStopOnFailureDraftChange: (draft: GlobalStopOnFailureDraft) => void;
}

export type WorkflowTestExecutionOverridesFieldsProps =
  | GroupModeProps
  | GlobalModeProps;

export function WorkflowTestExecutionOverridesFields(
  props: WorkflowTestExecutionOverridesFieldsProps,
) {
  const { idPrefix, disabled, resolvedDefaults, value, onChange } = props;
  const globalMode = props.mode === "global";

  const historyDefaultLabel = globalMode
    ? "Leave default"
    : `Default (${resolvedDefaults.history})`;

  const expectedDefaultLabel = globalMode
    ? "Leave default"
    : `Default (${EXPECTED_OUTCOME_LABELS[resolvedDefaults.expectedOutcome]})`;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField>
        <Label htmlFor={`${idPrefix}-history`}>History</Label>
        <Select
          id={`${idPrefix}-history`}
          value={value.history ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              history:
                e.target.value === "RESET" || e.target.value === "KEEP"
                  ? (e.target.value as WorkflowHistoryMode)
                  : undefined,
            })
          }
        >
          <option value="">{historyDefaultLabel}</option>
          <option value="RESET">RESET</option>
          <option value="KEEP">KEEP</option>
        </Select>
      </FormField>

      <FormField>
        <Label htmlFor={`${idPrefix}-expected`}>Expected outcome</Label>
        <Select
          id={`${idPrefix}-expected`}
          value={value.expectedOutcome ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              expectedOutcome: e.target.value
                ? (e.target.value as WorkflowExpectedOutcome)
                : undefined,
            })
          }
        >
          <option value="">{expectedDefaultLabel}</option>
          {EXPECTED_OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {EXPECTED_OUTCOME_LABELS[outcome]}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField>
        <Label htmlFor={`${idPrefix}-timeout`}>Timeout override (ms)</Label>
        <Input
          id={`${idPrefix}-timeout`}
          type="number"
          min={0}
          step={1000}
          value={value.timeoutMs ?? ""}
          placeholder={globalMode ? "Leave default" : "No timeout"}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              timeoutMs: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </FormField>

      {globalMode ? (
        <div className="flex flex-col gap-2 self-end pb-1">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={props.stopOnFailureDraft.enabled}
              disabled={disabled}
              className="rounded border-input"
              onChange={(e) =>
                props.onStopOnFailureDraftChange({
                  ...props.stopOnFailureDraft,
                  enabled: e.target.checked,
                })
              }
            />
            Set stop on failure
          </label>
          {props.stopOnFailureDraft.enabled && (
            <label className="flex items-center gap-2 pl-6 text-sm text-foreground">
              <input
                type="checkbox"
                checked={props.stopOnFailureDraft.value}
                disabled={disabled}
                className="rounded border-input"
                onChange={(e) =>
                  props.onStopOnFailureDraftChange({
                    ...props.stopOnFailureDraft,
                    value: e.target.checked,
                  })
                }
              />
              Stop on failure
            </label>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 self-end pb-1">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={value.stopOnFailure ?? resolvedDefaults.stopOnFailure}
              disabled={disabled}
              className="rounded border-input"
              onChange={(e) => onChange({ stopOnFailure: e.target.checked })}
            />
            Stop on failure
          </label>
        </div>
      )}
    </div>
  );
}
