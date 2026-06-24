export interface StressTestGroupInput {
  name: string;
  queriesText: string;
}

export function parseQueries(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of text.split(/[\n,]+/)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

export function countQueriesInGroups(groups: StressTestGroupInput[]): number {
  return groups.reduce(
    (total, group) => total + parseQueries(group.queriesText).length,
    0,
  );
}

export function toApiGroups(groups: StressTestGroupInput[]): Array<{
  name: string;
  queries: string[];
}> {
  return groups
    .map((group) => ({
      name: group.name.trim(),
      queries: parseQueries(group.queriesText),
    }))
    .filter((group) => group.name && group.queries.length > 0);
}
