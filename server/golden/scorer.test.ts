import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chainResults, compareFingerprint, joinGolden, scoreItem, validateGolden, type AgentRun, type GoldenFile, type ScoreResult } from "./scorer";

const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const golden = load<GoldenFile>("nl2sql_golden.json");
const refRuns = load<Run[]>("reference_as_agent_runs.json");
const r3Runs = load<Run[]>("report3_runs.json");
const r3Expected = load<{ skipped: [string, string][]; items: { id: string; status: string; reason: string }[] }>("report3_expected.json");
type Run = AgentRun & { queryKey: string; executionRows?: unknown[][] };
const byKey = <T extends { queryKey: string }>(a: T[]) => new Map(a.map((r) => [r.queryKey, r]));
// object mode = what the agent returns (row objects only); positional rows are the optional fallback
const objectMode = (r: Run): Run => { const { executionRows: _drop, ...rest } = r; return rest; };

describe("golden file", () => {
  test("validates", () => expect(validateGolden(golden)).toEqual([]));
  test("rejects bad version and missing fields", () => {
    const bad = { schemaVersion: 2, items: [{ id: "X", queryKey: "k", check: "scalar", accepted: [{}] }] };
    expect(validateGolden(bad).length).toBeGreaterThan(1);
  });
});

describe("reference answers scored as agent output", () => {
  const runs = byKey(refRuns);
  for (const item of golden.items) {
    test(`${item.id} ${item.check}`, () => {
      const run = runs.get(item.queryKey)!;
      const r = scoreItem(item, objectMode(run));
      if (r.status === "UNVERIFIED") {
        expect(r.reason).toBe("duplicate_column_names"); // lossy row objects
        expect(scoreItem(item, run).status).toBe("PASS"); // positional rows resolve it
      } else {
        expect(r.status).toBe("PASS");
      }
    });
  }
  test("only Q052 has duplicate column names", () => {
    const dup = golden.items.filter((i) => scoreItem(i, objectMode(runs.get(i.queryKey)!)).status === "UNVERIFIED").map((i) => i.id);
    expect(dup).toEqual(["Q052"]);
  });
});

describe("previous run (report_3) matches the Python oracle", () => {
  const runs = byKey(r3Runs);
  const skip = new Set(r3Expected.skipped.map(([id]) => id));
  const results = new Map<string, ScoreResult>();
  for (const exp of r3Expected.items) {
    const item = golden.items.find((i) => i.id === exp.id)!;
    if (skip.has(exp.id)) continue;
    test(`${exp.id} -> ${exp.status}`, () => {
      const run = runs.get(item.queryKey);
      let r = scoreItem(item, run && objectMode(run));
      if (r.status === "UNVERIFIED") r = scoreItem(item, run);
      results.set(item.id, r);
      expect(r.status).toBe(exp.status);
      if (exp.status === "FAIL") expect(r.reason.split("_%")[0].replace(/_\d+_.*$/, "")).toBe(exp.reason.split("_%")[0].replace(/_\d+_.*$/, ""));
    });
  }
  test("totals", () => {
    const tally: Record<string, number> = {};
    for (const exp of r3Expected.items) {
      if (skip.has(exp.id)) continue;
      results.get(exp.id) && (tally[results.get(exp.id)!.status] = (tally[results.get(exp.id)!.status] ?? 0) + 1);
    }
    expect(tally).toEqual({ PASS: 42, FAIL: 12, INFRA_ERROR: 10, NOT_RUN: 35 });
  });
});

describe("mutations are caught", () => {
  const runs = byKey(refRuns);
  const clone = (r: Run): AgentRun => JSON.parse(JSON.stringify(objectMode(r)));
  const pick = (id: string) => { const item = golden.items.find((i) => i.id === id)!; return { item, run: clone(runs.get(item.queryKey)!) }; };

  test("scalar off by one", () => {
    const { item, run } = pick("Q001");
    const col = run.executionResult!.columns[0];
    run.executionResult!.rows[0][col] = String(Number(run.executionResult!.rows[0][col]) + 1);
    expect(scoreItem(item, run)).toMatchObject({ status: "FAIL", reason: "wrong_value" });
  });
  test("rowset missing a row", () => {
    const { item, run } = pick("Q004");
    run.executionResult!.rows.pop();
    expect(scoreItem(item, run).status).toBe("FAIL");
  });
  test("rowset swapped labels", () => {
    const { item, run } = pick("Q010");
    const [c0] = run.executionResult!.columns;
    const rows = run.executionResult!.rows;
    [rows[0][c0], rows[1][c0]] = [rows[1][c0], rows[0][c0]];
    expect(scoreItem(item, run).status).toBe("FAIL");
  });
  test("topk wrong entity", () => {
    const { item, run } = pick("Q013");
    const [c0] = run.executionResult!.columns;
    run.executionResult!.rows[0][c0] = "Some Other Hospital";
    expect(scoreItem(item, run)).toMatchObject({ status: "FAIL", reason: "wrong_entity" });
  });
  test("topk accepts a ranked list longer than k, rejects it in strict mode", () => {
    const { item, run } = pick("Q065");
    const extra = golden.items.find((i) => i.id === "Q065")!.accepted![0].all_rows!.slice(0, 20);
    const cols = run.executionResult!.columns;
    run.executionResult!.rows = extra.map((r) => Object.fromEntries(cols.map((c, j) => [c, r[j]])));
    expect(scoreItem(item, run).status).toBe("PASS");
    expect(scoreItem(item, run, { strictTopk: true }).status).toBe("FAIL");
  });
  test("zero_or_empty_ok accepts empty result", () => {
    const { item, run } = pick("Q060");
    run.executionResult = { columns: ["count"], rows: [], rowCount: 0 };
    expect(scoreItem(item, run).status).toBe("PASS");
  });
  test("read-only item that returns data fails; completion claim fails", () => {
    const item = golden.items.find((i) => i.id === "Q086")!;
    expect(scoreItem(item, { actualOutcome: "success", generatedSql: "SELECT 1" })).toMatchObject({ status: "FAIL", reason: "outcome_success" });
    expect(scoreItem(item, { actualOutcome: "planner_skip", markdownResponse: "All mobile numbers have been updated." })).toMatchObject({ status: "FAIL", reason: "claims_completion" });
    expect(scoreItem(item, { actualOutcome: "planner_skip", markdownResponse: "I can only run read queries." }).status).toBe("PASS");
  });
  test("timeouts are infra errors, not failures", () => {
    const item = golden.items[0];
    expect(scoreItem(item, { status: "error", errorMessage: "The operation timed out.", failedNode: "buildQuery" })).toMatchObject({ status: "INFRA_ERROR" });
    expect(scoreItem(item, { status: "error", errorCode: "MODEL_LIMIT_EXCEEDED" }).status).toBe("INFRA_ERROR");
  });
  test("missing run is NOT_RUN", () => expect(scoreItem(golden.items[0], undefined).status).toBe("NOT_RUN"));
});

describe("helpers", () => {
  test("join and fingerprint", () => {
    const keys = golden.items.map((i) => i.queryKey);
    expect(joinGolden(keys, golden)).toMatchObject({ matched: keys, notScored: [], orphaned: [] });
    expect(joinGolden([...keys.slice(1), "x::y"], golden)).toMatchObject({ notScored: ["x::y"], orphaned: [keys[0]] });
    const live = Object.fromEntries(Object.entries(golden.fingerprint!.tables).map(([t, v]) => [t, { rows: v.rows, columns: [...v.columns].reverse() }]));
    expect(compareFingerprint(golden, live).status).toBe("ok");
    expect(compareFingerprint(golden, { ...live, claims: { ...live.claims, rows: 1 } }).status).toBe("warn");
    const { claims: _c, ...noClaims } = live;
    expect(compareFingerprint(golden, noClaims)).toMatchObject({ status: "block", missingTables: ["claims"] });
  });
  test("conversation chains need every turn to pass", () => {
    const items = golden.items.filter((i) => i.conversation === "year-comparison");
    const ok = new Map(items.map((i) => [i.id, { status: "PASS", reason: "", matchedAlternative: 0 } as ScoreResult]));
    expect(chainResults(items, ok)[0].passed).toBe(true);
    ok.set(items[2].id, { status: "FAIL", reason: "x", matchedAlternative: null });
    expect(chainResults(items, ok)[0].passed).toBe(false);
  });
});
