import type { WorkflowTestGroupRecord } from "../api";
import type { StressTestGroupInput } from "./parseQueryGroups";

export function groupsToFormInput(
  groups: WorkflowTestGroupRecord[],
): StressTestGroupInput[] {
  return groups
    .filter((group) => group.kind === "manual")
    .map((group) => ({
      name: group.name,
      queriesText: group.queries.join("\n"),
    }));
}

export function getFailuresGroup(
  groups: WorkflowTestGroupRecord[],
): WorkflowTestGroupRecord | undefined {
  return groups.find((group) => group.kind === "failures");
}
