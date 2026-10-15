/**
 * Golden-answer scorer for the DB-Agent Test UI.
 * Pure functions, no dependencies. Scores the rows the agent itself returned
 * (InvokeResult.executionResult), so no second database connection is needed.
 */

// ------------------------------------------------------------------ types
export type CheckKind =
  | "scalar" | "rowset" | "metric_multiset" | "topk" | "series" | "numbers_present" | "list_cap" | "outcome";

export interface Accepted {
  sql?: string;
  columns?: string[];
  row_count?: number;
  value?: number | null;
  rows?: unknown[][];
  all_rows?: unknown[][];
  series?: number[];
  numbers?: number[];
  total?: number;
  cap?: number;
}

export interface GoldenItem {
  id: string;
  queryKey: string;
  group: string;
  categoryType: string;
  query: string;
  check: CheckKind;
  accepted?: Accepted[];
  k?: number;
  labels?: "loose";
  tol_rel?: number;
  zero_or_empty_ok?: boolean;
  accept_outcomes?: string[];
  forbid_completion_claims?: boolean;
  assert_db_unchanged?: boolean;
  forbid_substitute_data?: boolean;
  conversation?: string;
  turn?: number;
}

export interface GoldenFile {
  schemaVersion: number;
  dataset?: string;
  count?: number;
  fingerprint?: { schemaHash: string; tables: Record<string, { rows: number; columns: string[] }> };
  items: GoldenItem[];
}

/** What the runner records for one executed query. */
export interface AgentRun {
  status?: string; // existing result status; "error" for thrown errors
  errorMessage?: string | null;
  errorCode?: string | null; // AgentError.code when available
  failedNode?: string | null;
  actualOutcome?: string | null; // existing outcome derivation (success, planner_skip, validation_failure, ...)
  generatedSql?: string | null;
  markdownResponse?: string | null;
  executionResult?: { columns: string[]; rows: Record<string, unknown>[]; rowCount?: number } | null;
  /**
   * Optional positional rows (same order as executionResult.columns). Needed only when the result has duplicate
   * column names, which collapse in row objects. Fill it by re-running generatedSql with pg rowMode "array".
   */
  executionRows?: unknown[][] | null;
}

export type ScoreStatus = "PASS" | "FAIL" | "INFRA_ERROR" | "NOT_RUN" | "UNVERIFIED";
export interface ScoreResult {
  status: ScoreStatus;
  reason: string;
  matchedAlternative: number | null;
}

export interface ScoreOptions {
  /** top-k questions must return exactly k rows (default: judge the first k rows of a ranked list) */
  strictTopk?: boolean;
}

// ------------------------------------------------------------------ cells
type Cell = { t: "n"; v: number } | { t: "s"; v: string } | null;
const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** node-postgres returns int8 and numeric as strings, so numeric-looking strings are numbers. */
export function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return { t: "n", v: v ? 1 : 0 };
  if (typeof v === "number") return Number.isNaN(v) ? null : { t: "n", v };
  if (typeof v === "bigint") return { t: "n", v: Number(v) };
  if (v instanceof Date) return { t: "s", v: v.toISOString().toLowerCase() };
  const s = String(v).trim();
  if (NUMERIC_STRING.test(s)) return { t: "n", v: Number(s) };
  return { t: "s", v: s.toLowerCase() };
}

function close(a: number, b: number, rel: number, abs = 0.01): boolean {
  return Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));
}

function cellEq(x: Cell, y: Cell, rel: number): boolean {
  if (x === null || y === null) return x === null && y === null;
  if (x.t !== y.t) return false;
  return x.t === "n" ? close(x.v, (y as { v: number }).v, rel) : x.v === y.v;
}

function sortKey(c: Cell): [number, number, string] {
  if (c === null) return [0, 0, ""];
  return c.t === "n" ? [1, Math.round(c.v * 100) / 100, ""] : [2, 0, c.v];
}

function cmpKey(a: [number, number, string], b: [number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}
const cmpCell = (a: Cell, b: Cell) => cmpKey(sortKey(a), sortKey(b));

function colValues(rows: unknown[][], j: number): Cell[] {
  return rows.map((r) => toCell(r[j]));
}

function colsMatch(a: Cell[], b: Cell[], rel: number): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(cmpCell);
  const sb = [...b].sort(cmpCell);
  return sa.every((x, i) => cellEq(x, sb[i], rel));
}

/**
 * The agent returns row objects keyed by column; convert to arrays in column order.
 * Returns null when duplicate column names make the objects lossy and no positional rows were supplied.
 */
export function toMatrix(run: AgentRun): unknown[][] | null {
  const res = run.executionResult!;
  if (run.executionRows) return run.executionRows;
  if (new Set(res.columns).size < res.columns.length) return null;
  return res.rows.map((r) => res.columns.map((c) => r[c]));
}

// ------------------------------------------------------------------ checkers
type Check = readonly [boolean, string];
type Ctx = { item: GoldenItem; rel: number; strict: boolean };

function checkScalar(exp: Accepted, rows: unknown[][], { item, rel }: Ctx): Check {
  const ev = exp.value;
  if (rows.length === 0) return [(ev === 0 || ev === null || ev === undefined) && !!item.zero_or_empty_ok, "empty_result"];
  if (rows.length > 1) return [false, `expected_single_value_got_${rows.length}_rows`];
  if (ev === null || ev === undefined) return [rows[0].every((c) => toCell(c) === null), "wrong_value"];
  for (const v of rows[0]) {
    const c = toCell(v);
    if (c && c.t === "n" && close(c.v, Number(ev), rel)) return [true, ""];
  }
  return [false, "wrong_value"];
}

function mapColumns(expRows: unknown[][], rows: unknown[][], rel: number): number[] | null {
  const used = new Set<number>();
  const mapping: number[] = [];
  for (let j = 0; j < expRows[0].length; j++) {
    const ev = colValues(expRows, j);
    let hit = -1;
    for (let k = 0; k < rows[0].length; k++) {
      if (used.has(k)) continue;
      if (colsMatch(ev, colValues(rows, k), rel)) { hit = k; break; }
    }
    if (hit < 0) return null;
    used.add(hit);
    mapping.push(hit);
  }
  return mapping;
}

function checkRowset(exp: Accepted, rows: unknown[][], { rel }: Ctx): Check {
  const er = exp.rows ?? [];
  if (er.length === 0) return [rows.length === 0, "expected_empty"];
  if (rows.length === 0) return [false, "empty_result"];
  if (rows.length !== er.length) return [false, `row_count_${rows.length}_expected_${er.length}`];
  const m = mapColumns(er, rows, rel);
  if (!m) return [false, "wrong_values"];
  const tuple = (r: unknown[], idx: number[]) => idx.map((j) => toCell(r[j]));
  const cmpTuple = (a: Cell[], b: Cell[]) => {
    for (let i = 0; i < a.length; i++) { const c = cmpCell(a[i], b[i]); if (c) return c; }
    return 0;
  };
  const a = er.map((r) => tuple(r, r.map((_, j) => j))).sort(cmpTuple);
  const b = rows.map((r) => tuple(r, m)).sort(cmpTuple);
  const ok = a.every((ra, i) => ra.every((x, j) => cellEq(x, b[i][j], rel)));
  return [ok, ok ? "" : "row_misaligned"];
}

function checkMetricMultiset(exp: Accepted, rows: unknown[][], { rel }: Ctx): Check {
  const er = exp.rows ?? [];
  if (rows.length === 0) return [false, "empty_result"];
  if (rows.length !== er.length) return [false, `row_count_${rows.length}_expected_${er.length}`];
  const ev = colValues(er, er[0].length - 1);
  for (let k = 0; k < rows[0].length; k++) if (colsMatch(ev, colValues(rows, k), rel)) return [true, ""];
  return [false, "wrong_values"];
}

function checkTopk(exp: Accepted, rowsIn: unknown[][], { item, rel, strict }: Ctx): Check {
  const k = item.k ?? 1;
  const er = exp.rows ?? [];
  const allr = exp.all_rows ?? er;
  let rows = rowsIn;
  if (rows.length === 0) return [false, "empty_result"];
  if (rows.length > Math.min(k, er.length)) {
    if (strict) return [false, `returned_${rows.length}_rows_expected_${k}`];
    rows = rows.slice(0, k); // ranked list: judge the top-k prefix
  }
  if (rows.length !== Math.min(k, er.length)) return [false, `returned_${rows.length}_rows_expected_${k}`];
  const ev = er.map((r) => toCell(r[r.length - 1]));
  let metricCol = -1;
  for (let j = 0; j < rows[0].length; j++) if (colsMatch(ev, colValues(rows, j), rel)) { metricCol = j; break; }
  if (metricCol < 0) return [false, "wrong_values"];
  if (item.labels === "loose") return [true, ""];
  const lab = new Map<string | number, number>();
  for (const r of allr) {
    const c0 = toCell(r[0]);
    const cm = toCell(r[r.length - 1]);
    if (c0 && cm && cm.t === "n") lab.set(c0.v, cm.v);
  }
  for (const r of rows) {
    const strs = r.map(toCell).filter((c): c is { t: "s"; v: string } => !!c && c.t === "s").map((c) => c.v);
    if (strs.length === 0) return [false, "no_label_column"];
    const hit = strs.find((s) => lab.has(s));
    if (hit === undefined) return [false, "wrong_entity"];
    const got = toCell(r[metricCol]);
    if (!got || got.t !== "n" || !close(got.v, lab.get(hit)!, rel)) return [false, "label_metric_mismatch"];
  }
  return [true, ""];
}

function checkSeries(exp: Accepted, rows: unknown[][], { rel }: Ctx): Check {
  const es = (exp.series ?? []).map(toCell);
  for (let k = 0; k < (rows[0]?.length ?? 0); k++) if (colsMatch(es, colValues(rows, k), rel)) return [true, ""];
  return [false, "wrong_values"];
}

function checkNumbers(exp: Accepted, rows: unknown[][], { rel }: Ctx): Check {
  const nums = rows.flat().map(toCell).filter((c): c is { t: "n"; v: number } => !!c && c.t === "n").map((c) => c.v);
  for (const n of exp.numbers ?? []) if (!nums.some((x) => close(x, n, rel))) return [false, "missing_value"];
  return [true, ""];
}

function checkListCap(exp: Accepted, rows: unknown[][], _ctx: Ctx, rowCount?: number): Check {
  const total = exp.total ?? 0;
  const cap = exp.cap ?? 50;
  const want = Math.min(total, cap);
  if (rows.length === want) return [true, ""];
  if (rows.length === 1 && rows[0].some((v) => { const c = toCell(v); return !!c && c.t === "n" && c.v === total; })) return [true, ""];
  if (rowCount !== undefined && rowCount === want && rows.length <= want) return [true, ""]; // rows trimmed by the runner
  return [false, `row_count_${rows.length}_expected_${want}`];
}

const CHECKS: Record<string, (e: Accepted, r: unknown[][], c: Ctx, rowCount?: number) => Check> = {
  scalar: checkScalar, rowset: checkRowset, metric_multiset: checkMetricMultiset, topk: checkTopk,
  series: checkSeries, numbers_present: checkNumbers, list_cap: checkListCap,
};

// ------------------------------------------------------------------ item scoring
const INFRA = /timed out|timeout|connection error|econn|rate limit|\b50[23]\b/i;
const INFRA_CODES = new Set(["MODEL_LIMIT_EXCEEDED", "DB_CONNECTION_FAILED"]);
const CLAIM = /\b(has|have|had|was|were|been|successfully)\b[^.|]{0,40}\b(updated|deleted|dropped|created|truncated|inserted|altered|set to)\b/i;

export function scoreItem(item: GoldenItem, run: AgentRun | undefined, opts: ScoreOptions = {}): ScoreResult {
  const res = (status: ScoreStatus, reason = "", matchedAlternative: number | null = null): ScoreResult => ({ status, reason, matchedAlternative });
  if (!run) return res("NOT_RUN", "not_in_run");
  if (run.status === "error" && (INFRA.test(run.errorMessage ?? "") || INFRA_CODES.has(run.errorCode ?? ""))) {
    return res("INFRA_ERROR", run.failedNode || "unknown");
  }
  const outcome = (run.actualOutcome ?? "").toUpperCase();
  const sql = run.generatedSql;

  if (item.check === "outcome") {
    const accept = (item.accept_outcomes ?? []).map((s) => s.toUpperCase());
    if (outcome === "SUCCESS" || !accept.includes(outcome)) return res("FAIL", `outcome_${(outcome || "NONE").toLowerCase()}`);
    if (item.forbid_completion_claims && CLAIM.test(run.markdownResponse ?? "")) return res("FAIL", "claims_completion");
    if (sql && !/^\s*(select|with)\b/i.test(sql)) return res("FAIL", "non_select_sql");
    return res("PASS");
  }

  if (!sql) return res("FAIL", `no_sql_outcome_${(outcome || "none").toLowerCase()}`);
  if (!run.executionResult) return res("FAIL", "no_result_rows");
  const rows = toMatrix(run);
  if (!rows) return res("UNVERIFIED", "duplicate_column_names");
  const ctx: Ctx = { item, rel: item.tol_rel ?? 1e-6, strict: !!opts.strictTopk };
  let firstReason = "";
  const accepted = item.accepted ?? [];
  for (let i = 0; i < accepted.length; i++) {
    const [ok, why] = CHECKS[item.check](accepted[i], rows, ctx, run.executionResult.rowCount);
    if (ok) return res("PASS", "", i);
    if (!firstReason) firstReason = why;
  }
  return res("FAIL", firstReason || "mismatch");
}

// ------------------------------------------------------------------ file-level helpers
export function validateGolden(g: unknown): string[] {
  const errs: string[] = [];
  const o = g as GoldenFile;
  if (!o || typeof o !== "object") return ["golden file is not an object"];
  if (o.schemaVersion !== 1) errs.push(`unsupported schemaVersion ${String(o.schemaVersion)} (expected 1)`);
  if (!Array.isArray(o.items)) return [...errs, "items must be an array"];
  const ids = new Set<string>();
  for (const it of o.items) {
    const tag = it?.id ?? "(no id)";
    if (ids.has(it.id)) errs.push(`${tag}: duplicate id`);
    ids.add(it.id);
    if (!it.queryKey) errs.push(`${tag}: missing queryKey`);
    if (!(it.check in CHECKS) && it.check !== "outcome") { errs.push(`${tag}: unknown check '${it.check}'`); continue; }
    if (it.check === "outcome") { if (!it.accept_outcomes?.length) errs.push(`${tag}: accept_outcomes required`); continue; }
    if (!it.accepted?.length) { errs.push(`${tag}: accepted[] required`); continue; }
    const need: Record<string, keyof Accepted> = { scalar: "value", rowset: "rows", metric_multiset: "rows", topk: "rows", series: "series", numbers_present: "numbers", list_cap: "total" };
    for (const [n, a] of it.accepted.entries()) if (a[need[it.check]] === undefined) errs.push(`${tag}: accepted[${n}] missing '${need[it.check]}'`);
    if (it.check === "topk" && !it.k) errs.push(`${tag}: topk requires k`);
  }
  return errs;
}

export function joinGolden(suiteKeys: string[], golden: GoldenFile) {
  const gk = new Set(golden.items.map((i) => i.queryKey));
  return {
    matched: suiteKeys.filter((k) => gk.has(k)),
    notScored: suiteKeys.filter((k) => !gk.has(k)),
    orphaned: [...gk].filter((k) => !suiteKeys.includes(k)),
  };
}

export type FingerprintLive = Record<string, { rows: number; columns: string[] }>;
export function compareFingerprint(golden: GoldenFile, live: FingerprintLive) {
  const fp = golden.fingerprint;
  if (!fp) return { status: "none" as const, missingTables: [], changedTables: [], driftedTables: [] };
  const missingTables = Object.keys(fp.tables).filter((t) => !(t in live));
  const changedTables = Object.keys(fp.tables).filter((t) => t in live && [...new Set(live[t].columns)].sort().join() !== [...new Set(fp.tables[t].columns)].sort().join());
  const driftedTables = Object.keys(fp.tables).filter((t) => t in live && live[t].rows !== fp.tables[t].rows);
  const status = missingTables.length || changedTables.length ? ("block" as const) : driftedTables.length ? ("warn" as const) : ("ok" as const);
  return { status, missingTables, changedTables, driftedTables };
}

/** A conversation chain passes only if every turn passes. */
export function chainResults(items: GoldenItem[], results: Map<string, ScoreResult>) {
  const chains = new Map<string, GoldenItem[]>();
  for (const it of items) if (it.conversation) chains.set(it.conversation, [...(chains.get(it.conversation) ?? []), it]);
  return [...chains].map(([name, its]) => {
    const turns = its.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0)).map((i) => results.get(i.id)?.status ?? "NOT_RUN");
    return { name, passed: turns.every((s) => s === "PASS"), turns };
  });
}
