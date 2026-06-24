export interface StressTestGroup {
  name: string;
  queries: string[];
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

export function normalizeGroups(
  groups: Array<{ name?: string; queries?: string[] | string }>,
): StressTestGroup[] {
  const normalized: StressTestGroup[] = [];

  for (const group of groups) {
    const name = group.name?.trim();
    if (!name) continue;

    const queries = Array.isArray(group.queries)
      ? group.queries.map((q) => q.trim()).filter(Boolean)
      : parseQueries(group.queries ?? "");

    if (queries.length === 0) continue;

    normalized.push({ name, queries });
  }

  return normalized;
}

export function flattenGroups(groups: StressTestGroup[]): Array<{
  groupName: string;
  query: string;
}> {
  const items: Array<{ groupName: string; query: string }> = [];
  for (const group of groups) {
    for (const query of group.queries) {
      items.push({ groupName: group.name, query });
    }
  }
  return items;
}
