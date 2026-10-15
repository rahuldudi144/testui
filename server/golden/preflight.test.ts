import { describe, expect, test } from "bun:test";
import { buildPreflight } from "./preflight.js";

const golden = {
  schemaVersion: 1,
  fingerprint: {
    schemaHash: "abc",
    tables: { hospitals: { rows: 10, columns: ["id", "name"] } },
  },
  items: [
    {
      id: "Q1",
      queryKey: "Standard::How many?",
      group: "Standard",
      categoryType: "STANDARD",
      query: "How many?",
      check: "outcome",
      accept_outcomes: ["WRITE_REFUSAL"],
    },
  ],
  extra: true,
};

describe("buildPreflight", () => {
  test("blocks a missing table and a column mismatch", () => {
    const missing = buildPreflight({
      suiteError: null,
      golden,
      suiteKeys: ["Standard::How many?"],
      live: {},
      liveError: null,
    });
    expect(missing.checks.find((check) => check.id === "fingerprint")?.status).toBe("block");
    expect(missing.blocked).toBe(true);
    expect(missing.onlyFingerprintBlocked).toBe(true);

    const changed = buildPreflight({
      suiteError: null,
      golden,
      suiteKeys: ["Standard::How many?"],
      live: { hospitals: { rows: 10, columns: ["id"] } },
      liveError: null,
    });
    expect(changed.checks.find((check) => check.id === "fingerprint")?.status).toBe("block");
  });

  test("warns on row-count drift and unknown fields", () => {
    const report = buildPreflight({
      suiteError: null,
      golden,
      suiteKeys: ["Standard::How many?"],
      live: { hospitals: { rows: 11, columns: ["name", "id"] } },
      liveError: null,
    });
    expect(report.checks.find((check) => check.id === "fingerprint")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "golden")?.status).toBe("warn");
    expect(report.blocked).toBe(false);
  });

  test("blocks when nothing joins", () => {
    const report = buildPreflight({
      suiteError: null,
      golden,
      suiteKeys: ["Other::nope"],
      live: { hospitals: { rows: 10, columns: ["id", "name"] } },
      liveError: null,
    });
    expect(report.checks.find((check) => check.id === "join")?.status).toBe("block");
    expect(report.onlyFingerprintBlocked).toBe(false);
  });
});
