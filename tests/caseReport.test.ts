import { describe, it, expect } from "vitest";
import {
  buildCaseJson, buildCaseMarkdown, verifyCaseImport, REPORT_SCHEMA,
  buildCaseCsv, buildMaltegoCsv, buildStixBundle,
} from "@/lib/analysis/caseReport";
import type { InvestigationCase } from "@/lib/types";

const baseCase: InvestigationCase = {
  id: "case-1",
  name: "Acme phishing 2026",
  createdAt: 1_000,
  updatedAt: 2_000,
  entities: [
    { kind: "domain", value: "evil.example", addedAt: 1_500 },
    { kind: "email", value: "sender@evil.example", addedAt: 1_600, note: "spoofed from" },
  ],
  notes: "Initial hypothesis: credential harvest.",
};

describe("caseReport — JSON export", () => {
  it("wraps the case with schema, version and a 64-hex SHA-256 integrity hash", async () => {
    const { json, hash } = await buildCaseJson(baseCase);
    const env = JSON.parse(json);
    expect(env.schema).toBe(REPORT_SCHEMA);
    expect(env.tool).toBe("HEAVEN-GeoIntel");
    expect(env.integrity.algo).toBe("SHA-256");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(env.integrity.hash).toBe(hash);
    expect(env.case.entities).toHaveLength(2);
  });

  it("produces a deterministic hash regardless of entity ordering", async () => {
    const reordered: InvestigationCase = {
      ...baseCase,
      entities: [...baseCase.entities].reverse(),
    };
    const a = await buildCaseJson(baseCase);
    const b = await buildCaseJson(reordered);
    expect(a.hash).toBe(b.hash);
  });
});

describe("caseReport — import + integrity check", () => {
  it("round-trips an exported report with integrity verified (not tampered)", async () => {
    const { json } = await buildCaseJson(baseCase);
    const check = await verifyCaseImport(json);
    expect(check.ok).toBe(true);
    expect(check.tampered).toBe(false);
    expect(check.case?.name).toBe("Acme phishing 2026");
    expect(check.case?.entities).toHaveLength(2);
  });

  it("detects tampering when the payload is modified after signing", async () => {
    const { json } = await buildCaseJson(baseCase);
    const env = JSON.parse(json);
    env.case.entities[0].value = "good.example"; // mutate after hashing
    const check = await verifyCaseImport(JSON.stringify(env));
    expect(check.ok).toBe(true);
    expect(check.tampered).toBe(true);
    expect(check.expectedHash).not.toBe(check.actualHash);
  });

  it("rejects JSON that is not a HEAVEN-GeoIntel case report", async () => {
    const check = await verifyCaseImport(JSON.stringify({ hello: "world" }));
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/not a heaven-geointel/i);
  });

  it("rejects non-JSON input", async () => {
    const check = await verifyCaseImport("<<<not json>>>");
    expect(check.ok).toBe(false);
  });
});

describe("caseReport — interop exports", () => {
  it("CSV has a header + one row per identifier, quoted", () => {
    const csv = buildCaseCsv(baseCase);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("kind,value,addedAt,note");
    expect(lines).toHaveLength(3); // header + 2 entities
    expect(csv).toContain('"sender@evil.example"');
  });

  it("neutralises CSV formula injection in values and notes", () => {
    const evilCase: InvestigationCase = {
      ...baseCase,
      entities: [
        { kind: "phone", value: "+14155550000", addedAt: 1_700 },
        { kind: "username", value: "=cmd|'/c calc'!A1", addedAt: 1_800, note: "@SUM(1+1)" },
      ],
    };
    const csv = buildCaseCsv(evilCase);
    // Leading formula triggers (= + - @) get a defensive single-quote prefix.
    expect(csv).toContain(`"'+14155550000"`);
    expect(csv).toContain(`"'=cmd|'/c calc'!A1"`);
    expect(csv).toContain(`"'@SUM(1+1)"`);
    // A benign value (does not start with a trigger char) is left untouched.
    const benign = buildCaseCsv(baseCase);
    expect(benign).toContain('"sender@evil.example"');
    expect(benign).not.toContain(`"'sender@evil.example"`);
  });

  it("Maltego CSV maps kinds to Maltego entity types", () => {
    const csv = buildMaltegoCsv(baseCase);
    expect(csv).toContain('"maltego.Domain","evil.example"');
    expect(csv).toContain('"maltego.EmailAddress","sender@evil.example"');
  });

  it("STIX bundle is valid 2.1 with SCOs for each identifier", () => {
    const bundle = JSON.parse(buildStixBundle(baseCase));
    expect(bundle.type).toBe("bundle");
    expect(bundle.id).toMatch(/^bundle--/);
    const types = bundle.objects.map((o: { type: string }) => o.type);
    expect(types).toContain("identity");
    expect(types).toContain("domain-name");
    expect(types).toContain("email-addr");
    const email = bundle.objects.find((o: { type: string }) => o.type === "email-addr");
    expect(email.value).toBe("sender@evil.example");
    expect(email.spec_version).toBe("2.1");
  });
});

describe("caseReport — Markdown report", () => {
  it("includes the case name, an entity value and the integrity hash", async () => {
    const md = await buildCaseMarkdown(baseCase);
    expect(md).toContain("Acme phishing 2026");
    expect(md).toContain("evil.example");
    expect(md).toMatch(/Integrity \(SHA-256 of case payload\): `[0-9a-f]{64}`/);
  });
});
