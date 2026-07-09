import type { QueryRunResult } from "../api";

export interface CompareRow {
  queryKey: string;
  groupName: string;
  query: string;
  a?: QueryRunResult;
  b?: QueryRunResult;
  statusMatch: boolean;
  answerMatch?: boolean;
}

export function finalAnswerText(result?: QueryRunResult): string | undefined {
  if (!result) return undefined;
  const markdown = result.markdownResponse?.trim() || result.markdownPreview?.trim();
  if (markdown) return markdown;
  if (result.errorMessage?.trim()) {
    return `Error: ${result.errorMessage.trim()}`;
  }
  return undefined;
}

export function normalizeAnswerForCompare(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function answersMatch(
  a?: QueryRunResult,
  b?: QueryRunResult,
): boolean | undefined {
  if (!a || !b) return undefined;
  const textA = finalAnswerText(a);
  const textB = finalAnswerText(b);
  if (!textA && !textB) return true;
  if (!textA || !textB) return false;
  return normalizeAnswerForCompare(textA) === normalizeAnswerForCompare(textB);
}

export function resultQueryKey(result: QueryRunResult): string {
  if (result.queryKey) return result.queryKey;
  const normalized = result.query.trim().replace(/\s+/g, " ");
  return `${result.groupName}::${normalized}`;
}

export function alignCompareResults(
  resultsA: QueryRunResult[],
  resultsB: QueryRunResult[],
): CompareRow[] {
  const mapA = new Map(resultsA.map((result) => [resultQueryKey(result), result]));
  const mapB = new Map(resultsB.map((result) => [resultQueryKey(result), result]));
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);

  return [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((queryKey) => {
      const a = mapA.get(queryKey);
      const b = mapB.get(queryKey);
      return {
        queryKey,
        groupName: a?.groupName ?? b?.groupName ?? "",
        query: a?.query ?? b?.query ?? "",
        a,
        b,
        statusMatch: a !== undefined && b !== undefined && a.status === b.status,
        answerMatch: answersMatch(a, b),
      };
    });
}

export function countOverlappingQueries(
  resultsA: QueryRunResult[],
  resultsB: QueryRunResult[],
): number {
  const keysB = new Set(resultsB.map(resultQueryKey));
  return resultsA.filter((result) => keysB.has(resultQueryKey(result))).length;
}
