import { createHash } from "crypto";
import pg from "pg";
import {
  compareFingerprint,
  joinGolden,
  validateGolden,
  type FingerprintLive,
  type GoldenFile,
} from "./scorer.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LARGE_TABLE_ESTIMATE = 1_000_000;

const ROOT_KEYS = new Set([
  "schemaVersion",
  "dataset",
  "count",
  "fingerprint",
  "items",
  "referenceDialect",
]);
const ITEM_KEYS = new Set([
  "id",
  "queryKey",
  "group",
  "categoryType",
  "query",
  "check",
  "accepted",
  "k",
  "labels",
  "tol_rel",
  "zero_or_empty_ok",
  "accept_outcomes",
  "forbid_completion_claims",
  "assert_db_unchanged",
  "forbid_substitute_data",
  "conversation",
  "turn",
  "note",
]);
const ACCEPTED_KEYS = new Set([
  "sql",
  "columns",
  "row_count",
  "value",
  "rows",
  "all_rows",
  "series",
  "numbers",
  "total",
  "cap",
  "cutoff_tied",
]);

export interface PreflightCheck {
  id: "suite" | "golden" | "join" | "fingerprint";
  status: "pass" | "warn" | "block";
  messages: string[];
}

export interface PreflightReport {
  checks: PreflightCheck[];
  blocked: boolean;
  fingerprintBlocked: boolean;
  onlyFingerprintBlocked: boolean;
  fingerprintStatus: "none" | "ok" | "warn" | "block";
  schemaHash: string | null;
  join: { matched: number; notScored: string[]; orphaned: string[] };
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function unknownGoldenWarnings(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as Record<string, unknown>;
  const warnings: string[] = [];
  for (const key of Object.keys(root)) {
    if (!ROOT_KEYS.has(key)) warnings.push(`Unknown field '${key}'`);
  }
  if (!Array.isArray(root.items)) return warnings;
  for (const item of root.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const tag = typeof record.id === "string" ? record.id : "(item)";
    for (const key of Object.keys(record)) {
      if (!ITEM_KEYS.has(key)) warnings.push(`${tag}: unknown field '${key}'`);
    }
    if (!Array.isArray(record.accepted)) continue;
    record.accepted.forEach((accepted, index) => {
      if (!accepted || typeof accepted !== "object" || Array.isArray(accepted)) return;
      for (const key of Object.keys(accepted as Record<string, unknown>)) {
        if (!ACCEPTED_KEYS.has(key)) {
          warnings.push(`${tag}: accepted[${index}] unknown field '${key}'`);
        }
      }
    });
  }
  return warnings;
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) {
    throw new Error("Invalid SQL identifier.");
  }
  return `"${name}"`;
}

function withinOnePercent(live: number, expected: number): boolean {
  const denom = Math.max(Math.abs(expected), 1);
  return Math.abs(live - expected) / denom <= 0.01;
}

export interface LiveFingerprintRead {
  live: FingerprintLive;
  warnings: string[];
  privilegeWarning: string | null;
}

export async function readLiveFingerprint(
  connectionString: string,
  schema: string,
  tables: string[],
): Promise<LiveFingerprintRead> {
  const safeSchema = quoteIdent(schema).slice(1, -1);
  const safeTables = tables.filter((table) => IDENT.test(table));
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL default_transaction_read_only = on");
    await client.query("SET LOCAL statement_timeout = '10s'");

    const columnResult = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = ANY($2::text[])
       ORDER BY table_name, ordinal_position`,
      [safeSchema, safeTables],
    );
    const columns = new Map<string, string[]>();
    for (const row of columnResult.rows) {
      const list = columns.get(row.table_name) ?? [];
      list.push(row.column_name);
      columns.set(row.table_name, list);
    }

    const estimate = await client.query<{ relname: string; reltuples: number }>(
      `SELECT c.relname, c.reltuples::float8 AS reltuples
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND c.relkind = 'r'`,
      [safeSchema, safeTables],
    );
    const estimates = new Map(estimate.rows.map((row) => [row.relname, Number(row.reltuples)]));

    const live: FingerprintLive = {};
    const warnings: string[] = [];
    for (const table of safeTables) {
      if (!columns.has(table)) continue;
      const estimated = estimates.get(table) ?? 0;
      let rows: number;
      if (estimated > LARGE_TABLE_ESTIMATE) {
        rows = Math.round(estimated);
        warnings.push(`${table} row count is approximate`);
      } else {
        const counted = await client.query<{ n: string }>(
          `SELECT count(*)::bigint AS n FROM ${quoteIdent(safeSchema)}.${quoteIdent(table)}`,
        );
        rows = Number(counted.rows[0]?.n ?? 0);
      }
      live[table] = { rows, columns: columns.get(table) ?? [] };
    }

    const grants = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.role_table_grants
       WHERE grantee = current_user
         AND table_schema = $1
         AND table_name = ANY($2::text[])
         AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
      [safeSchema, safeTables],
    );
    const writable = [...new Set(grants.rows.map((row) => row.table_name))];
    const privilegeWarning =
      writable.length > 0
        ? `The database role can change rows in: ${writable.join(", ")}.`
        : null;

    await client.query("ROLLBACK");
    return { live, warnings, privilegeWarning };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function buildPreflight(input: {
  suiteError: string | null;
  golden: unknown;
  suiteKeys: string[];
  live: FingerprintLive | null;
  liveError: string | null;
  fingerprintWarnings?: string[];
  privilegeWarning?: string | null;
}): PreflightReport {
  const checks: PreflightCheck[] = [];

  checks.push(
    input.suiteError
      ? { id: "suite", status: "block", messages: [input.suiteError] }
      : { id: "suite", status: "pass", messages: ["Suite file is valid."] },
  );

  const goldenErrors = validateGolden(input.golden);
  const goldenWarnings = unknownGoldenWarnings(input.golden);
  if (goldenErrors.length > 0) {
    checks.push({ id: "golden", status: "block", messages: goldenErrors });
  } else if (goldenWarnings.length > 0) {
    checks.push({ id: "golden", status: "warn", messages: goldenWarnings });
  } else {
    checks.push({ id: "golden", status: "pass", messages: ["Golden file is valid."] });
  }

  const goldenFile =
    goldenErrors.length === 0 && input.golden && typeof input.golden === "object"
      ? (input.golden as GoldenFile)
      : null;
  const joined = goldenFile
    ? joinGolden(input.suiteKeys, goldenFile)
    : { matched: [], notScored: input.suiteKeys, orphaned: [] as string[] };

  if (!goldenFile) {
    checks.push({
      id: "join",
      status: "block",
      messages: ["Join skipped because the golden file is invalid."],
    });
  } else if (joined.matched.length === 0) {
    checks.push({
      id: "join",
      status: "block",
      messages: ["No suite queries matched a golden item."],
    });
  } else if (joined.notScored.length > 0 || joined.orphaned.length > 0) {
    const messages = [`${joined.matched.length} matched.`];
    if (joined.notScored.length > 0) {
      messages.push(`Unmatched suite queries: ${joined.notScored.slice(0, 20).join(" | ")}`);
    }
    if (joined.orphaned.length > 0) {
      messages.push(`Orphaned golden keys: ${joined.orphaned.slice(0, 20).join(" | ")}`);
    }
    checks.push({ id: "join", status: "warn", messages });
  } else {
    checks.push({
      id: "join",
      status: "pass",
      messages: [`${joined.matched.length} matched.`],
    });
  }

  let fingerprintStatus: PreflightReport["fingerprintStatus"] = "none";
  const fingerprintMessages: string[] = [];
  if (!goldenFile?.fingerprint) {
    fingerprintMessages.push("Golden file has no fingerprint.");
    checks.push({ id: "fingerprint", status: "pass", messages: fingerprintMessages });
  } else if (input.liveError) {
    fingerprintStatus = "block";
    checks.push({ id: "fingerprint", status: "block", messages: [input.liveError] });
  } else if (!input.live) {
    fingerprintStatus = "block";
    checks.push({
      id: "fingerprint",
      status: "block",
      messages: ["Database fingerprint was not read."],
    });
  } else {
    const live = { ...input.live };
    const expected = goldenFile.fingerprint.tables;
    for (const warning of input.fingerprintWarnings ?? []) {
      const table = warning.split(" ")[0] ?? "";
      if (
        table &&
        live[table] &&
        expected[table] &&
        warning.includes("approximate") &&
        withinOnePercent(live[table].rows, expected[table].rows)
      ) {
        live[table] = { ...live[table], rows: expected[table].rows };
        fingerprintMessages.push(`${table} row count is approximate and within 1%.`);
      } else if (warning) {
        fingerprintMessages.push(warning);
      }
    }
    const compared = compareFingerprint(goldenFile, live);
    fingerprintStatus = compared.status;
    if (compared.missingTables.length > 0) {
      fingerprintMessages.push(`Missing tables: ${compared.missingTables.join(", ")}`);
    }
    if (compared.changedTables.length > 0) {
      fingerprintMessages.push(`Column mismatch: ${compared.changedTables.join(", ")}`);
    }
    if (compared.driftedTables.length > 0) {
      fingerprintMessages.push(`Row count drift: ${compared.driftedTables.join(", ")}`);
    }
    if (input.privilegeWarning) fingerprintMessages.push(input.privilegeWarning);
    if (fingerprintMessages.length === 0) fingerprintMessages.push("Fingerprint matches.");
    const status =
      compared.status === "block" ? "block" : compared.status === "warn" || input.privilegeWarning
        ? "warn"
        : "pass";
    checks.push({ id: "fingerprint", status, messages: fingerprintMessages });
  }

  const blocked = checks.some((check) => check.status === "block");
  const fingerprintBlocked = checks.some(
    (check) => check.id === "fingerprint" && check.status === "block",
  );
  const onlyFingerprintBlocked =
    fingerprintBlocked &&
    checks.every((check) => check.id === "fingerprint" || check.status !== "block");

  return {
    checks,
    blocked,
    fingerprintBlocked,
    onlyFingerprintBlocked,
    fingerprintStatus,
    schemaHash: goldenFile?.fingerprint?.schemaHash ?? null,
    join: {
      matched: joined.matched.length,
      notScored: joined.notScored,
      orphaned: joined.orphaned,
    },
  };
}
