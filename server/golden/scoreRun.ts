import pg from "pg";
import type { QueryRunResult, StressTestSummary } from "../stressTestAnalyze.js";
import { buildQueryKey } from "../workflowTestObservability.js";
import {
  chainResults,
  scoreItem,
  type AgentRun,
  type GoldenFile,
  type GoldenItem,
  type ScoreResult,
} from "./scorer.js";

const INFRA = /timed out|timeout|connection error|econn|rate limit|\b50[23]\b/i;
const INFRA_CODES = new Set(["MODEL_LIMIT_EXCEEDED", "DB_CONNECTION_FAILED"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PREVIEW_ROWS = 20;
const PREVIEW_COLS = 12;

export interface QueryInvokeCapture {
  executionResult: AgentRun["executionResult"];
  errorCode: string | null;
}

export interface DbSnapshot {
  tables: string[];
  counts: Record<string, number | null>;
  tuples: Record<string, number>;
}

export interface GoldenSummary {
  accuracy: number | null;
  rawPassRate: number | null;
  passAtK: number | null;
  passCaretK: number | null;
  counts: Record<string, number>;
  reasonHistogram: Record<string, number>;
  chains: Array<{ name: string; passed: boolean; turns: string[] }>;
  unsafe: boolean;
}

export function clampRepeats(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(5, Math.max(1, Math.trunc(parsed)));
}

export function infraBackoffMs(extraAttempt: number): number {
  const base = 250 * 2 ** Math.max(0, extraAttempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

export function isInfraForRetry(
  result: QueryRunResult,
  capture: QueryInvokeCapture | null,
): boolean {
  if (result.actualOutcome === "infra_error") return true;
  if (capture?.errorCode && INFRA_CODES.has(capture.errorCode)) return true;
  return INFRA.test(result.errorMessage ?? "");
}

export function expandRepeatItems<T extends { groupName: string; query: string }>(
  items: T[],
  repeats: number,
  existing: QueryRunResult[],
): Array<T & { runIndex: number }> {
  const count = clampRepeats(repeats);
  const done = new Set(
    existing.map((result) => {
      const key = result.queryKey ?? buildQueryKey(result.groupName, result.query);
      return `${key}::${result.runIndex ?? 1}`;
    }),
  );
  const expanded: Array<T & { runIndex: number }> = [];
  for (const item of items) {
    const key = buildQueryKey(item.groupName, item.query);
    for (let runIndex = 1; runIndex <= count; runIndex += 1) {
      if (done.has(`${key}::${runIndex}`)) continue;
      expanded.push({ ...item, runIndex });
    }
  }
  return expanded;
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error("Invalid SQL identifier.");
  return `"${name}"`;
}

export function singleReadStatement(sql: string): string | null {
  const body = sql.trim().replace(/;+\s*$/, "").trim();
  if (!body || body.includes(";")) return null;
  if (!/^\s*(select|with)\b/i.test(body)) return null;
  return body;
}

async function withReadOnlyClient<T>(
  connectionString: string,
  statementTimeout: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL default_transaction_read_only = on");
    await client.query(`SET LOCAL statement_timeout = '${statementTimeout}'`);
    const value = await run(client);
    await client.query("ROLLBACK");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function readDbSnapshot(
  connectionString: string | undefined,
  schema: string,
): Promise<DbSnapshot | null> {
  if (!connectionString || !IDENT.test(schema)) return null;
  return withReadOnlyClient(connectionString, "10s", async (client) => {
    const tables = await client.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind = 'r'
       ORDER BY c.relname`,
      [schema],
    );
    const names = tables.rows.map((row) => row.relname).filter((name) => IDENT.test(name));
    const stats = await client.query<{
      relname: string;
      n_tup_ins: string;
      n_tup_upd: string;
      n_tup_del: string;
      reltuples: number;
    }>(
      `SELECT c.relname,
              COALESCE(s.n_tup_ins, 0)::bigint AS n_tup_ins,
              COALESCE(s.n_tup_upd, 0)::bigint AS n_tup_upd,
              COALESCE(s.n_tup_del, 0)::bigint AS n_tup_del,
              c.reltuples::float8 AS reltuples
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE n.nspname = $1 AND c.relkind = 'r'`,
      [schema],
    );
    const statByName = new Map(stats.rows.map((row) => [row.relname, row]));
    const counts: Record<string, number | null> = {};
    const tuples: Record<string, number> = {};
    for (const name of names) {
      const stat = statByName.get(name);
      const estimated = Number(stat?.reltuples ?? 0);
      tuples[name] =
        Number(stat?.n_tup_ins ?? 0) + Number(stat?.n_tup_upd ?? 0) + Number(stat?.n_tup_del ?? 0);
      if (estimated > 1_000_000) {
        counts[name] = null;
        continue;
      }
      const counted = await client.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(name)}`,
      );
      counts[name] = Number(counted.rows[0]?.n ?? 0);
    }
    return { tables: names, counts, tuples };
  });
}

export function snapshotsDiffer(before: DbSnapshot, after: DbSnapshot): boolean {
  if (before.tables.join("\n") !== after.tables.join("\n")) return true;
  for (const table of before.tables) {
    if (before.counts[table] !== after.counts[table]) return true;
    if (before.tuples[table] !== after.tuples[table]) return true;
  }
  return false;
}

export async function readGeneratedSqlRows(
  connectionString: string,
  sql: string,
): Promise<{ columns: string[]; rows: unknown[][] } | null> {
  const statement = singleReadStatement(sql);
  if (!statement) return null;
  return withReadOnlyClient(connectionString, "30s", async (client) => {
    const result = await client.query({
      text: `SELECT * FROM (${statement}) AS golden_fallback LIMIT 1000`,
      rowMode: "array",
    });
    const columns = result.fields.map((field) => field.name);
    const rows = (result.rows as unknown[][]).slice(0, 1000);
    return { columns, rows };
  });
}

function previewMatrix(columns: string[], rows: unknown[][]): { columns: string[]; rows: unknown[][] } {
  return {
    columns: columns.slice(0, PREVIEW_COLS),
    rows: rows.slice(0, PREVIEW_ROWS).map((row) => row.slice(0, PREVIEW_COLS)),
  };
}

function gotPreview(run: AgentRun): unknown {
  if (run.executionRows && run.executionRows.length > 0) {
    const width = run.executionRows[0]?.length ?? 0;
    const columns = run.executionResult?.columns?.slice(0, width) ?? [];
    return previewMatrix(columns, run.executionRows);
  }
  const columns = run.executionResult?.columns ?? [];
  const rows = (run.executionResult?.rows ?? []).map((row) => columns.map((column) => row[column]));
  if (columns.length === 0 && rows.length === 0) return null;
  return previewMatrix(columns, rows);
}

function expectedPreview(item: GoldenItem, matched: number | null): unknown {
  const accepted = item.accepted?.[matched ?? 0];
  if (!accepted) return null;
  if (accepted.rows) {
    return previewMatrix(accepted.columns ?? [], accepted.rows);
  }
  if (accepted.value !== undefined) return { value: accepted.value };
  if (accepted.series) return { series: accepted.series.slice(0, PREVIEW_ROWS) };
  if (accepted.numbers) return { numbers: accepted.numbers.slice(0, PREVIEW_ROWS) };
  return null;
}

function agentRunFrom(result: QueryRunResult, capture: QueryInvokeCapture | null): AgentRun {
  const infra = result.actualOutcome === "infra_error" || result.status === "error";
  return {
    status: infra ? "error" : result.status,
    errorMessage: result.errorMessage ?? null,
    errorCode: capture?.errorCode ?? null,
    failedNode: result.failedNode ?? null,
    actualOutcome: result.actualOutcome ?? null,
    generatedSql: result.generatedSql ?? null,
    markdownResponse: result.markdownResponse ?? result.markdownPreview ?? null,
    executionResult: capture?.executionResult ?? null,
  };
}

export async function scoreWorkflowResult(input: {
  result: QueryRunResult;
  capture: QueryInvokeCapture | null;
  item: GoldenItem | undefined;
  runIndex: number;
  goldenAttempts: number;
  scoringDbUri?: string;
}): Promise<QueryRunResult> {
  const { result, item, runIndex, goldenAttempts } = input;
  if (!item) {
    return {
      ...result,
      goldenStatus: "NOT_SCORED",
      goldenReason: "no_golden_item",
      runIndex,
      goldenAttempts,
    };
  }

  const agentRun = agentRunFrom(result, input.capture);
  let scored = scoreItem(item, agentRun);
  if (
    scored.status === "UNVERIFIED" &&
    scored.reason === "duplicate_column_names" &&
    input.scoringDbUri &&
    agentRun.generatedSql
  ) {
    try {
      const fallback = await readGeneratedSqlRows(input.scoringDbUri, agentRun.generatedSql);
      if (fallback) {
        agentRun.executionRows = fallback.rows;
        if (!agentRun.executionResult) {
          agentRun.executionResult = {
            columns: fallback.columns,
            rows: [],
            rowCount: fallback.rows.length,
          };
        }
        scored = scoreItem(item, agentRun);
      }
    } catch {
      scored = { status: "UNVERIFIED", reason: "duplicate_column_names", matchedAlternative: null };
    }
  }

  return {
    ...result,
    goldenId: item.id,
    goldenStatus: scored.status,
    goldenReason: scored.reason,
    matchedAlternative: scored.matchedAlternative,
    gotPreview: gotPreview(agentRun),
    expectedPreview: expectedPreview(item, scored.matchedAlternative),
    goldenAttempts,
    runIndex,
    goldenConversation: item.conversation ?? null,
    goldenTurn: item.turn ?? null,
    goldenAcceptedCount: item.accepted?.length ?? item.accept_outcomes?.length ?? 0,
  };
}

function chainsFromResults(results: QueryRunResult[]) {
  const grouped = new Map<string, Map<string, QueryRunResult[]>>();
  for (const result of results) {
    if (!result.goldenConversation || !result.goldenId) continue;
    const turns = grouped.get(result.goldenConversation) ?? new Map<string, QueryRunResult[]>();
    const rows = turns.get(result.goldenId) ?? [];
    rows.push(result);
    turns.set(result.goldenId, rows);
    grouped.set(result.goldenConversation, turns);
  }
  return [...grouped].map(([name, turns]) => {
    const ordered = [...turns.values()].sort(
      (left, right) => (left[0]?.goldenTurn ?? 0) - (right[0]?.goldenTurn ?? 0),
    );
    const statuses = ordered.map((rows) => passKStatus(rows) ?? "NOT_RUN");
    return {
      name,
      passed: statuses.every((status) => status === "PASS"),
      turns: statuses,
    };
  });
}

function passKStatus(rows: QueryRunResult[]): string | undefined {
  const statuses = rows
    .map((row) => row.goldenStatus)
    .filter((status): status is NonNullable<QueryRunResult["goldenStatus"]> => Boolean(status));
  if (statuses.length === 0) return undefined;
  if (statuses.every((status) => status === "PASS")) return "PASS";
  if (statuses.some((status) => status === "FAIL")) return "FAIL";
  if (statuses.some((status) => status === "INFRA_ERROR")) return "INFRA_ERROR";
  if (statuses.some((status) => status === "UNVERIFIED")) return "UNVERIFIED";
  if (statuses.some((status) => status === "NOT_SCORED")) return "NOT_SCORED";
  return statuses[0];
}

export function buildGoldenSummary(
  results: QueryRunResult[],
  golden: GoldenFile | null,
): GoldenSummary {
  const byKey = new Map<string, QueryRunResult[]>();
  for (const result of results) {
    const key = result.goldenId ?? result.queryKey ?? `${result.groupName}::${result.query}`;
    const list = byKey.get(key) ?? [];
    list.push(result);
    byKey.set(key, list);
  }

  const counts: Record<string, number> = {};
  const reasonHistogram: Record<string, number> = {};
  let pass = 0;
  let fail = 0;
  let comparable = 0;
  let anyPass = 0;
  let rawDenom = 0;
  const idStatus = new Map<string, ScoreResult>();

  for (const [key, rows] of byKey) {
    const status = passKStatus(rows);
    if (!status) continue;
    counts[status] = (counts[status] ?? 0) + 1;
    const reason = rows.find((row) => row.goldenReason)?.goldenReason;
    if (reason && status !== "PASS") {
      reasonHistogram[reason] = (reasonHistogram[reason] ?? 0) + 1;
    }
    if (status !== "NOT_SCORED" && status !== "NOT_RUN") rawDenom += 1;
    if (status === "PASS" || status === "FAIL") {
      comparable += 1;
      if (status === "PASS") pass += 1;
      if (status === "FAIL") fail += 1;
    }
    if (rows.some((row) => row.goldenStatus === "PASS")) anyPass += 1;
    const goldenId = rows.find((row) => row.goldenId)?.goldenId ?? key;
    idStatus.set(goldenId, {
      status: status === "NOT_SCORED" ? "NOT_RUN" : (status as ScoreResult["status"]),
      reason: reason ?? "",
      matchedAlternative: null,
    });
  }

  const scored = pass + fail;
  const chains = golden
    ? chainResults(golden.items, idStatus)
    : chainsFromResults(results);
  return {
    accuracy: scored === 0 ? null : pass / scored,
    rawPassRate: rawDenom === 0 ? null : pass / rawDenom,
    passCaretK: scored === 0 ? null : pass / scored,
    passAtK: comparable === 0 ? null : anyPass / comparable,
    counts,
    reasonHistogram,
    chains,
    unsafe: results.some((result) => result.goldenReason === "db_modified"),
  };
}

export function withGoldenSummary(
  summary: StressTestSummary,
  results: QueryRunResult[],
  golden: GoldenFile | null,
): StressTestSummary {
  if (!results.some((result) => result.goldenStatus)) return summary;
  return { ...summary, golden: buildGoldenSummary(results, golden) };
}

export function markDbModified(
  results: QueryRunResult[],
  groupName: string,
  queryKeys?: Set<string>,
): void {
  for (const result of results) {
    if (result.groupName !== groupName) continue;
    const key = result.queryKey ?? buildQueryKey(result.groupName, result.query);
    if (queryKeys && !queryKeys.has(key)) continue;
    if (!result.goldenStatus || result.goldenStatus === "NOT_SCORED" || result.goldenStatus === "NOT_RUN") {
      continue;
    }
    result.goldenStatus = "FAIL";
    result.goldenReason = "db_modified";
  }
}
