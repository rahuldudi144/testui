import type { StressTestGroupInput } from "./parseQueryGroups";

export function groupsToFormInput(
  groups: Array<{ name: string; queries: string[] }>,
): StressTestGroupInput[] {
  return groups.map((group) => ({
    name: group.name,
    queriesText: group.queries.join("\n"),
  }));
}
