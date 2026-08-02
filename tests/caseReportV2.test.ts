import { describe, it, expect } from "vitest";
import {
  buildCaseJson, buildCaseMarkdown, verifyCaseImport,
  REPORT_SCHEMA, REPORT_SCHEMA_V1, sha256Hex,
} from "@/lib/analysis/caseReport";
import type { InvestigationCase } from "@/lib/types";

// Phase 4.7: the export is now "everything the case knows" — identifiers, the
// derived graph, and the change history — under schema v2, while v1 reports
// exported before the change must still verify as untampered.

const base: InvestigationCase = {
  id: "c1",
  name: "Op Kestrel",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  entities: [
    { kind: "email", value: "ada@example.com", addedAt: 1_700_000_000_000 },
    { kind: "domain", value: "example.com", addedAt: 1_700_000_000_500, note: "mail | host" },
  ],
  notes: "Working theory.",
};

const withGraph = (over: Partial<InvestigationCase> = {}): InvestigationCase => ({
  ...base,
  edges: [
    { from: { kind: "email", value: "ada@example.com" }, to: { kind: "domain", value: "example.com" }, reason: "Email domain", addedAt: 10 },
    { from: { kind: "email", value: "ada@example.com" }, to: { kind: "domain", value: "aspmx.l.google.com" }, reason: "EmailRep | MX", addedAt: 20 },
  ],
  snapshots: [
    { kind: "domain", value: "example.com", takenAt: 100, facts: { subdomains: 3, spf: "present" } },
    { kind: "domain", value: "example.com", takenAt: 200, facts: { subdomains: 7, spf: "present" } },
    { kind: "email", value: "ada@example.com", takenAt: 150, facts: { breaches: 1 } },
  ],
  ...over,
});

describe("JSON export", () => {
  it("declares schema v2 and carries the graph and history", async () => {
    const { json } = await buildCaseJson(withGraph());
    const env = JSON.parse(json);
    expect(env.schema).toBe(REPORT_SCHEMA);
    expect(env.case.edges).toHaveLength(2);
    expect(env.case.snapshots).toHaveLength(3);
  });

  it("emits empty sections for a case that has neither", async () => {
    const env = JSON.parse((await buildCaseJson(base)).json);
    expect(env.case.edges).toEqual([]);
    expect(env.case.snapshots).toEqual([]);
  });

  it("hashes deterministically regardless of the input ordering", async () => {
    const a = await buildCaseJson(withGraph());
    const shuffled = withGraph({
      edges: [...withGraph().edges!].reverse(),
      snapshots: [...withGraph().snapshots!].reverse(),
      entities: [...base.entities].reverse(),
    });
    expect((await buildCaseJson(shuffled)).hash).toBe(a.hash);
  });
});

describe("Markdown report", () => {
  it("renders the derived-links table with the reason for each edge", async () => {
    const md = await buildCaseMarkdown(withGraph());
    expect(md).toContain("## Derived links");
    expect(md).toContain("**Derived links:** 2");
    expect(md).toContain("Email domain");
    // Pipes inside a value must be escaped or they break the table.
    expect(md).toContain("EmailRep \\| MX");
  });

  it("renders only the facts that moved between consecutive snapshots", async () => {
    const md = await buildCaseMarkdown(withGraph());
    expect(md).toContain("## Change history");
    expect(md).toContain("| subdomains | 3 | 7 |");
    expect(md).not.toContain("| spf |");     // unchanged → not a row
  });

  it("calls a single snapshot a BASELINE, not 'no change'", async () => {
    const md = await buildCaseMarkdown(withGraph());
    expect(md).toContain("_Baseline only — re-run this identifier to see what changes._");
  });

  it("says so explicitly when nothing moved across several snapshots", async () => {
    const md = await buildCaseMarkdown(withGraph({
      snapshots: [
        { kind: "ip", value: "8.8.8.8", takenAt: 1, facts: { openPorts: 2 } },
        { kind: "ip", value: "8.8.8.8", takenAt: 2, facts: { openPorts: 2 } },
      ],
    }));
    expect(md).toContain("_nothing changed across 2 snapshots_");
  });

  it("renders an em-dash for a fact that appeared or disappeared", async () => {
    const md = await buildCaseMarkdown(withGraph({
      snapshots: [
        { kind: "ip", value: "8.8.8.8", takenAt: 1, facts: { gone: "x" } },
        { kind: "ip", value: "8.8.8.8", takenAt: 2, facts: { added: "y" } },
      ],
    }));
    expect(md).toContain("| added | — | y |");
    expect(md).toContain("| gone | x | — |");
  });

  it("states plainly when a case has no graph or history at all", async () => {
    const md = await buildCaseMarkdown(base);
    expect(md).toContain("_No derived links recorded._");
    expect(md).toContain("_No lookups have been snapshotted for this case._");
  });
});

describe("import verification across schema versions", () => {
  it("round-trips a v2 export as verified", async () => {
    const { json } = await buildCaseJson(withGraph());
    const check = await verifyCaseImport(json);
    expect(check.ok).toBe(true);
    expect(check.schemaVersion).toBe(2);
    expect(check.verified).toBe(true);
    expect(check.tampered).toBe(false);
    expect(check.case!.edges).toHaveLength(2);
    expect(check.case!.snapshots).toHaveLength(3);
  });

  it("still verifies a v1 report exported before the graph existed", async () => {
    // Built exactly as the old exporter did: the v1 payload, hashed as v1.
    const v1Payload = {
      name: base.name,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      entities: [...base.entities].sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value)),
      notes: base.notes,
    };
    const file = JSON.stringify({
      tool: "HEAVEN-GeoIntel",
      schema: REPORT_SCHEMA_V1,
      version: "1.3.0",
      exportedAt: new Date().toISOString(),
      integrity: { algo: "SHA-256", hash: await sha256Hex(JSON.stringify(v1Payload)) },
      case: v1Payload,
    });
    const check = await verifyCaseImport(file);
    expect(check.schemaVersion).toBe(1);
    expect(check.verified).toBe(true);
    expect(check.tampered).toBe(false);
  });

  it("flags a v2 report whose graph was edited after export", async () => {
    const { json } = await buildCaseJson(withGraph());
    const env = JSON.parse(json);
    env.case.edges[0].reason = "tampered";
    const check = await verifyCaseImport(JSON.stringify(env));
    expect(check.tampered).toBe(true);
    expect(check.verified).toBe(false);
  });

  it("rejects an unknown schema", async () => {
    const file = JSON.stringify({ schema: "something/else@9", case: {} });
    expect(await verifyCaseImport(file)).toEqual({ ok: false, error: "Not a HEAVEN-GeoIntel case report" });
  });

  it("drops malformed edges and snapshots from an untrusted file", async () => {
    const { json } = await buildCaseJson(withGraph());
    const env = JSON.parse(json);
    env.case.edges.push(
      { from: { kind: "bogus", value: "x" }, to: { kind: "domain", value: "y.com" }, reason: "bad kind" },
      { from: { kind: "email", value: "" }, to: { kind: "domain", value: "y.com" }, reason: "blank" },
      { from: { kind: "email", value: "a@b.com" }, reason: "no target" },
      "junk",
    );
    env.case.snapshots.push(
      { kind: "bogus", value: "x", takenAt: 1, facts: {} },
      { kind: "domain", value: "", takenAt: 1, facts: {} },
      null,
    );
    const check = await verifyCaseImport(JSON.stringify(env));
    expect(check.case!.edges).toHaveLength(2);
    expect(check.case!.snapshots).toHaveLength(3);
    // The hash covers the CANONICAL payload, so junk that doesn't survive
    // sanitisation leaves it matching — correct about the case, but silent
    // about the file. `dropped` is what makes the edit visible.
    expect(check.tampered).toBe(false);
    expect(check.dropped).toBe(7);
  });

  it("reports dropped:0 for a clean file", async () => {
    const { json } = await buildCaseJson(withGraph());
    expect((await verifyCaseImport(json)).dropped).toBe(0);
  });

  it("counts entities dropped by the v1 sanitizer too", async () => {
    const file = JSON.stringify({
      schema: REPORT_SCHEMA_V1,
      case: { name: "X", entities: [{ kind: "email", value: "a@b.com" }, { kind: "bogus", value: "x" }, 7] },
    });
    expect((await verifyCaseImport(file)).dropped).toBe(2);
  });

  it("coerces a snapshot's facts to scalars and defaults its timestamps", async () => {
    const file = JSON.stringify({
      schema: REPORT_SCHEMA,
      case: {
        name: "X", entities: [],
        edges: [{ from: { kind: "email", value: "a@b.com" }, to: { kind: "domain", value: "b.com" } }],
        snapshots: [{ kind: "domain", value: "b.com", facts: { n: 1, s: "y", bad: { deep: 1 }, nan: Number.NaN } }],
      },
    });
    const check = await verifyCaseImport(file);
    expect(check.case!.snapshots[0].facts).toEqual({ n: 1, s: "y" });
    expect(check.case!.edges[0].reason).toBe("derived");
    expect(check.case!.snapshots[0].takenAt).toBeTypeOf("number");
    // No integrity block at all → we can vouch for nothing, either way.
    expect(check.verified).toBe(false);
    expect(check.tampered).toBe(false);
  });

  it("ignores a snapshot whose facts are not an object", async () => {
    const file = JSON.stringify({
      schema: REPORT_SCHEMA,
      case: { name: "X", entities: [], snapshots: [
        { kind: "ip", value: "1.1.1.1", takenAt: 1, facts: "nope" },
        { kind: "ip", value: "2.2.2.2", takenAt: 2, facts: [1, 2] },
      ] },
    });
    const check = await verifyCaseImport(file);
    expect(check.case!.snapshots.map((s) => s.facts)).toEqual([{}, {}]);
  });

  it("ignores non-array graph sections", async () => {
    const file = JSON.stringify({
      schema: REPORT_SCHEMA,
      case: { name: "X", entities: [], edges: "nope", snapshots: 42 },
    });
    const check = await verifyCaseImport(file);
    expect(check.case!.edges).toEqual([]);
    expect(check.case!.snapshots).toEqual([]);
  });

  it("carries fromCache through verification", async () => {
    const file = JSON.stringify({
      schema: REPORT_SCHEMA,
      case: { name: "X", entities: [], snapshots: [{ kind: "ip", value: "1.1.1.1", takenAt: 1, facts: {}, fromCache: true }] },
    });
    expect((await verifyCaseImport(file)).case!.snapshots[0].fromCache).toBe(true);
  });
});
