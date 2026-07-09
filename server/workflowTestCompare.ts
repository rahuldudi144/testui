import { buildQueryKey } from "./workflowTestObservability.js";
import type { QueryRunResult } from "./stressTestAnalyze.js";

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
  return result.queryKey ?? buildQueryKey(result.groupName, result.query);
}

export function alignCompareResults(
  resultsA: QueryRunResult[],
  resultsB: QueryRunResult[],
): CompareRow[] {
  const mapA = new Map(resultsA.map((r) => [resultQueryKey(r), r]));
  const mapB = new Map(resultsB.map((r) => [resultQueryKey(r), r]));
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);

  return [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((queryKey) => {
      const a = mapA.get(queryKey);
      const b = mapB.get(queryKey);
      const groupName = a?.groupName ?? b?.groupName ?? "";
      const query = a?.query ?? b?.query ?? "";
      const statusMatch =
        a !== undefined && b !== undefined && a.status === b.status;

      return {
        queryKey,
        groupName,
        query,
        a,
        b,
        statusMatch,
        answerMatch: answersMatch(a, b),
      };
    });
}

export function countOverlappingQueries(
  resultsA: QueryRunResult[],
  resultsB: QueryRunResult[],
): number {
  const keysB = new Set(resultsB.map(resultQueryKey));
  return resultsA.filter((r) => keysB.has(resultQueryKey(r))).length;
}
