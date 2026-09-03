import { describe, it, expect } from "vitest";
import {
  buildCaseJson, buildCaseMarkdown, verifyCaseImport, REPORT_SCHEMA,
  buildCaseCsv, buildMaltegoCsv, buildStixBundle, buildPrintableHtml,
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

describe("caseReport: JSON export", () => {
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

describe("caseReport: import + integrity check", () => {
  it("round-trips an exported report with integrity verified (not tampered)", async () => {
    const { json } = await buildCaseJson(baseCase);
    const check = await verifyCaseImport(json);
    expect(check.ok).toBe(true);
    expect(check.tampered).toBe(false);
    expect(check.verified).toBe(true);
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
    expect(check.verified).toBe(false);
    expect(check.expectedHash).not.toBe(check.actualHash);
  });

  it("never reports a hash-less report as verified", async () => {
    const { json } = await buildCaseJson(baseCase);
    const env = JSON.parse(json);
    delete env.integrity; // strip the signature entirely
    const check = await verifyCaseImport(JSON.stringify(env));
    expect(check.ok).toBe(true);
    expect(check.tampered).toBe(false); // nothing to compare against
    expect(check.verified).toBe(false); // …so it is NOT verified either
    expect(check.expectedHash).toBeUndefined();
  });

  it("survives a malformed entities array instead of throwing, and flags it as tampered", async () => {
    const { json } = await buildCaseJson(baseCase);
    const env = JSON.parse(json);
    // Untrusted file: nulls, wrong types, an unknown kind, a non-string value.
    env.case.entities = [null, "nope", 42, { kind: "wat", value: "x" }, { kind: "ip", value: 8 },
      { kind: "ip", value: "8.8.8.8", addedAt: "yesterday", note: 7 }];
    const check = await verifyCaseImport(JSON.stringify(env));
    expect(check.ok).toBe(true);
    expect(check.case?.entities).toHaveLength(1); // only the salvageable one survives
    expect(check.case?.entities[0]).toMatchObject({ kind: "ip", value: "8.8.8.8", note: undefined });
    expect(Number.isFinite(check.case!.entities[0]!.addedAt)).toBe(true);
    expect(check.tampered).toBe(true); // repaired payload no longer matches the hash
  });

  it("coerces non-string/non-numeric envelope fields rather than throwing", async () => {
    const check = await verifyCaseImport(JSON.stringify({
      schema: REPORT_SCHEMA,
      integrity: { algo: "SHA-256", hash: 12345 }, // not a string → treated as absent
      case: { name: 7, notes: false, createdAt: "x", updatedAt: null, entities: { not: "an array" } },
    }));
    expect(check.ok).toBe(true);
    expect(check.case?.name).toBe("");
    expect(check.case?.notes).toBe("");
    expect(check.case?.entities).toEqual([]);
    expect(Number.isFinite(check.case!.createdAt)).toBe(true);
    expect(check.expectedHash).toBeUndefined();
    expect(check.verified).toBe(false);
  });

  it("rejects an envelope whose `case` is not an object", async () => {
    const check = await verifyCaseImport(JSON.stringify({ schema: REPORT_SCHEMA, case: "hello" }));
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/not a heaven-geointel/i);
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

describe("caseReport: interop exports", () => {
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

describe("caseReport: Markdown report", () => {
  it("includes the case name, an entity value and the integrity hash", async () => {
    const md = await buildCaseMarkdown(baseCase);
    expect(md).toContain("Acme phishing 2026");
    expect(md).toContain("evil.example");
    expect(md).toMatch(/Integrity \(SHA-256 of case payload\): `[0-9a-f]{64}`/);
  });
});

describe("caseReport: STIX covers every entity kind", () => {
  it("emits ipv4-addr, user-account and x-phone-number objects", () => {
    const c: InvestigationCase = {
      ...baseCase,
      entities: [
        { kind: "ip", value: "8.8.8.8", addedAt: 1 },
        { kind: "username", value: "torvalds", addedAt: 2 },
        { kind: "phone", value: "+14155552671", addedAt: 3 },
      ],
    };
    const bundle = JSON.parse(buildStixBundle(c));
    const byType = Object.fromEntries(bundle.objects.map((o: { type: string }) => [o.type, o]));
    expect(byType["ipv4-addr"].value).toBe("8.8.8.8");
    expect(byType["user-account"].account_login).toBe("torvalds");
    expect(byType["x-phone-number"].value).toBe("+14155552671");
  });
});

describe("caseReport: printable HTML", () => {
  it("produces a self-contained HTML doc with the (escaped) case name", async () => {
    const c: InvestigationCase = { ...baseCase, name: "A&B <script>" };
    const html = await buildPrintableHtml(c);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("A&amp;B &lt;script&gt;"); // escaped, no raw injection
    expect(html).not.toContain("<script>A"); // the raw name is not injected as markup
  });
});

describe("caseReport: empty / minimal edge cases", () => {
  const emptyCase = {
    id: "e", name: "Empty", createdAt: 1, updatedAt: 2, entities: [],
    notes: undefined as unknown as string,
  } as InvestigationCase;

  it("renders the placeholder row and 'None' notes for an empty case", async () => {
    const md = await buildCaseMarkdown(emptyCase);
    expect(md).toContain("_no identifiers_");
    expect(md).toContain("_None._");
  });

  it("sorts entities of the same kind by value, and CSV-escapes nullish notes", () => {
    const sameKind = {
      ...baseCase,
      entities: [
        { kind: "email", value: "z@x.com", addedAt: 1 },              // note undefined
        { kind: "email", value: "a@x.com", addedAt: 2, note: "=cmd" }, // formula-injection
      ],
    } as InvestigationCase;
    const csv = buildCaseCsv(sameKind);
    expect(csv.indexOf("a@x.com")).toBeLessThan(csv.indexOf("z@x.com")); // sorted by value
    expect(csv).toContain("\"'=cmd\""); // formula neutralised
  });
});

describe("caseReport: verifyCaseImport envelopes", () => {
  it("rejects non-JSON and non-report envelopes", async () => {
    expect((await verifyCaseImport("{bad")).ok).toBe(false);
    expect((await verifyCaseImport("null")).ok).toBe(false);
    expect((await verifyCaseImport(JSON.stringify({ schema: "wrong" }))).ok).toBe(false);
    expect((await verifyCaseImport(JSON.stringify({ schema: REPORT_SCHEMA }))).ok).toBe(false); // no case
  });

  it("accepts a minimal report, filling defaults for missing case fields", async () => {
    const res = await verifyCaseImport(JSON.stringify({ schema: REPORT_SCHEMA, case: {} }));
    expect(res.ok).toBe(true);
    expect(res.case?.name).toBe("");
    expect(res.case?.entities).toEqual([]);
    expect(res.tampered).toBe(false);  // no integrity hash present…
    expect(res.verified).toBe(false);  // …so it cannot be called verified
  });
});
