import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { loadEnv } from "../env.js";
import { suiteImportError } from "../parseStressQueries.js";
import { buildQueryKey } from "../workflowTestObservability.js";
import type { GoldenFile, GoldenItem } from "./scorer.js";
import {
  buildPreflight,
  readLiveFingerprint,
  sha256Text,
  type PreflightReport,
} from "./preflight.js";

export interface StoredGolden {
  id: string;
  name: string;
  fileHash: string;
  schemaVersion: number;
  itemCount: number;
  warnings: string[];
  errors: string[];
}

function asGolden(value: unknown): GoldenFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as GoldenFile;
}

export async function createGoldenSet(
  userId: string,
  body: { name?: string; content?: unknown },
): Promise<StoredGolden> {
  const content = body.content;
  const report = buildPreflight({
    suiteError: null,
    golden: content,
    suiteKeys: [],
    live: null,
    liveError: null,
  });
  const goldenCheck = report.checks.find((check) => check.id === "golden");
  const errors = goldenCheck?.status === "block" ? goldenCheck.messages : [];
  const warnings = goldenCheck?.status === "warn" ? goldenCheck.messages : [];
  const golden = asGolden(content);
  if (errors.length > 0 || !golden) {
    return {
      id: "",
      name: body.name?.trim() || "Golden answer",
      fileHash: "",
      schemaVersion: golden?.schemaVersion ?? 0,
      itemCount: 0,
      warnings,
      errors: errors.length > 0 ? errors : ["Golden file is invalid."],
    };
  }

  const name = body.name?.trim() || golden.dataset || "Golden answer";
  const fileHash = sha256Text(JSON.stringify(content));
  const created = await prisma.goldenSet.create({
    data: {
      userId,
      name,
      fileHash,
      schemaVersion: golden.schemaVersion,
      fingerprint: golden.fingerprint
        ? (golden.fingerprint as Prisma.InputJsonValue)
        : undefined,
      itemCount: golden.items.length,
      content: content as Prisma.InputJsonValue,
    },
  });

  return {
    id: created.id,
    name: created.name,
    fileHash: created.fileHash,
    schemaVersion: created.schemaVersion,
    itemCount: created.itemCount,
    warnings,
    errors: [],
  };
}

export async function loadOwnedGolden(userId: string, goldenSetId: string) {
  return prisma.goldenSet.findFirst({
    where: { id: goldenSetId, userId },
  });
}

export function suiteKeysFromGroups(
  groups: Array<{ name?: string; queries?: string[] }>,
): string[] {
  const keys: string[] = [];
  for (const group of groups) {
    const name = group.name?.trim();
    if (!name || !Array.isArray(group.queries)) continue;
    for (const query of group.queries) {
      if (!query.trim()) continue;
      keys.push(buildQueryKey(name, query));
    }
  }
  return keys;
}

export async function preflightGoldenUpload(input: {
  groups: Array<{ name?: string; queries?: unknown }>;
  golden: unknown;
  connectionString?: string;
  schema?: string;
}): Promise<PreflightReport> {
  const suiteError = suiteImportError(input.groups);
  const suiteKeys = suiteKeysFromGroups(
    input.groups.map((group) => ({
      name: group.name,
      queries: Array.isArray(group.queries)
        ? group.queries.filter((entry): entry is string => typeof entry === "string")
        : [],
    })),
  );
  const golden = asGolden(input.golden);
  const tables = golden?.fingerprint ? Object.keys(golden.fingerprint.tables) : [];
  let live = null;
  let liveError: string | null = null;
  let fingerprintWarnings: string[] = [];
  let privilegeWarning: string | null = null;
  if (golden?.fingerprint) {
    if (!input.connectionString) {
      liveError = "DB_AGENT_DB_URI is not set, so the fingerprint was not read.";
    } else {
      try {
        const read = await readLiveFingerprint(
          input.connectionString,
          input.schema || "public",
          tables,
        );
        live = read.live;
        fingerprintWarnings = read.warnings;
        privilegeWarning = read.privilegeWarning;
      } catch {
        liveError = "Could not read the database fingerprint.";
      }
    }
  }
  return buildPreflight({
    suiteError,
    golden: input.golden,
    suiteKeys,
    live,
    liveError,
    fingerprintWarnings,
    privilegeWarning,
  });
}

export async function preflightStoredGolden(input: {
  userId: string;
  goldenSetId: string;
  groups: Array<{ name?: string; queries?: unknown }>;
}): Promise<PreflightReport | { error: string }> {
  const row = await loadOwnedGolden(input.userId, input.goldenSetId);
  if (!row) return { error: "Golden answer set was not found." };
  const env = loadEnv();
  return preflightGoldenUpload({
    groups: input.groups,
    golden: row.content,
    connectionString: env.TESTUI_SCORING_DB_URI || env.DB_AGENT_DB_URI,
    schema: env.TESTUI_GOLDEN_PG_SCHEMA,
  });
}

export interface GoldenRunContext {
  file: GoldenFile;
  byKey: Map<string, GoldenItem>;
  repeats: number;
  retryInfra: boolean;
  stopOnCircuitBreaker: boolean;
  scoringDbUri?: string;
  schema: string;
  snapshotGroups: Set<string>;
  fileHash: string;
}

export async function loadGoldenRunContext(
  userId: string,
  goldenSetId: string,
  options: { repeats: number; retryInfra: boolean; stopOnCircuitBreaker: boolean },
): Promise<GoldenRunContext | null> {
  const row = await loadOwnedGolden(userId, goldenSetId);
  const file = asGolden(row?.content);
  if (!row || !file) return null;
  const env = loadEnv();
  const byKey = new Map(file.items.map((item) => [item.queryKey, item]));
  const snapshotGroups = new Set(
    file.items.filter((item) => item.assert_db_unchanged).map((item) => item.group),
  );
  return {
    file,
    byKey,
    repeats: options.repeats,
    retryInfra: options.retryInfra,
    stopOnCircuitBreaker: options.stopOnCircuitBreaker,
    scoringDbUri: env.TESTUI_SCORING_DB_URI || env.DB_AGENT_DB_URI,
    schema: env.TESTUI_GOLDEN_PG_SCHEMA || "public",
    snapshotGroups,
    fileHash: row.fileHash,
  };
}
