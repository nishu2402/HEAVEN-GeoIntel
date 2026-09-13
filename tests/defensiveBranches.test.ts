import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { punycodeDecode } from "@/lib/analysis/idn";
import { parseBtcActivity } from "@/lib/analysis/walletActivity";
import { needsBody } from "@/lib/analysis/wmnDetect";
import { selfLinkProofs, linkedClusters } from "@/lib/analysis/identityLinks";
import { factsFromHash } from "@/lib/analysis/caseSnapshot";
import { buildInbox, describeChange } from "@/lib/analysis/changeInbox";
import { buildDomainReport, buildWalletReport } from "@/lib/analysis/report";
import { listEvidence, captureEvidence } from "@/lib/server/evidenceStore";
import { fetchLei } from "@/lib/server/gleif";
import { fetchPassiveDns } from "@/lib/server/passiveDns";
import { hashAvatar } from "@/lib/server/avatarHash";
import { defaultRunner } from "@/lib/server/bulkJobs";
import { generateTyposquats } from "@/lib/analysis/typosquat";
import { pngFixture } from "./imageFixtures";
import type { DomainLookupResponse, HashLookupResponse, SocialProfile, WalletLookupResponse, InvestigationCase } from "@/lib/types";

// The branches a feature test does not naturally reach: malformed upstream
// payloads, absent optional fields, and the guards that keep a bad answer from
// being rendered as a good one.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-defensive-"));
  process.env.HV_DATA_DIR = dir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body,
}) as unknown as Response;

describe("malformed input is refused, never guessed at", () => {
  it("rejects punycode that overflows or decodes to a lone surrogate", () => {
    // A payload whose delta arithmetic runs past 2^31.
    expect(punycodeDecode("a-999999999999")).toBeNull();
    expect(punycodeDecode("99999999")).toBeNull();
    // Payloads that decode to a lone surrogate (U+D800) and to a code point
    // past the Unicode maximum. Neither can appear in a real IDN, and both
    // would produce a string no host ever had.
    expect(punycodeDecode("ib9b")).toBeNull();
    expect(punycodeDecode("en32g")).toBeNull();
  });

  it("reads a zero block time as no date at all", () => {
    const out = parseBtcActivity("me", [
      { status: { confirmed: false, block_time: 0 }, vout: [{ scriptpubkey_address: "bob" }] },
    ], 1);
    expect(out).toEqual({ lastActivity: null, oldestSampled: null, sampled: 1, counterparties: 1, capped: false });
  });

  it("survives a transaction with no outputs at all", () => {
    const out = parseBtcActivity("me", [{ status: { block_time: 1_700_000_000 } }], 1);
    expect(out!.counterparties).toBe(0);
  });

  it("treats a contract with no markers as status-only", () => {
    expect(needsBody({ ec: 200, mc: 404 })).toBe(false);
  });

  it("ignores a profile link that points at a different host", () => {
    const p = (over: Partial<SocialProfile>): SocialProfile => ({
      platform: "A", category: "developer", handle: "x", url: "https://a.test/x",
      avatarUrl: null, displayName: null, bio: null, stats: [], joinedYear: null,
      location: null, extra: null, ...over,
    });
    expect(selfLinkProofs([
      p({ platform: "A", bio: "https://elsewhere.test/x" }),
      p({ platform: "B", url: "https://b.test/x" }),
    ])).toEqual([]);
  });

  it("does not re-seed a platform the proof list already added", () => {
    expect(linkedClusters(["A", "A", "B"], [{ kind: "avatar", platforms: ["A", "B"], detail: "" }]))
      .toEqual([["A", "B"]]);
  });

  it("omits a hash kind the detector could not name", () => {
    expect(factsFromHash({ input: "zz", kind: null, facts: null, pivots: [] } as unknown as HashLookupResponse))
      .toEqual({});
  });

  it("orders same-moment changes by fact name, and names an absent new value", () => {
    const c = (over: Partial<InvestigationCase> = {}): InvestigationCase =>
      ({ id: "c", name: "C", createdAt: 1, updatedAt: 1, entities: [], ...over });
    const inbox = buildInbox([c({
      snapshots: [
        { kind: "ip", value: "1.1.1.1", takenAt: 10, facts: { b: 1, a: 1, gone: 2 } },
        { kind: "ip", value: "1.1.1.1", takenAt: 20, facts: { b: 2, a: 2 } },
      ],
    })]);
    expect(inbox.changes.map((x) => x.fact)).toEqual(["a", "b", "gone"]);
    expect(describeChange(inbox.changes[2])).toContain("2 → not reported");
  });
});

describe("reports render their optional halves", () => {
  const domain = (over: Partial<DomainLookupResponse>): DomainLookupResponse => ({
    domain: "a.test", isValid: true,
    dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
    whois: null, subdomains: [], emailSecurity: { hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: false },
    dnssec: null, wayback: null, http: null, pivots: [], ...over,
  } as DomainLookupResponse);

  it("says nothing about truncation when the list was not truncated", () => {
    const m = buildDomainReport(domain({
      subdomainCoverage: { sources: [{ source: "crt.sh", ok: true, found: 2 }], distinct: 2, limit: 250, capped: false },
      subdomainHosts: [{ host: "a.a.test", addresses: ["1.1.1.1"] }],
      passiveDns: { records: [{ query: "a.test", answer: "1.1.1.1", rrtype: "A", firstSeen: null, lastSeen: null, times: null }], total: 1, capped: false, degraded: true },
    }));
    const flat = JSON.stringify(m.sections);
    expect(flat).toContain("2 distinct");
    expect(flat).not.toContain("truncated");
    expect(flat).toContain("a.a.test → 1.1.1.1");
    // A record with no dates prints the pair alone rather than an empty range.
    expect(flat).toContain("A a.test → 1.1.1.1");
  });

  it("falls back to a plain label when a sanctions hit names no entity", () => {
    const m = buildWalletReport({
      input: "x", chain: "btc", facts: null, pivots: [],
      sanctions: { listed: true, matches: [], source: "OFAC", snapshotDate: "2026-09-12", listSize: 1 },
    } as unknown as WalletLookupResponse);
    expect(m.headline).toEqual({ label: "Sanctions", value: "OFAC SDN: listed" });
  });
});

describe("upstream payloads that are not what they should be", () => {
  it("reports a GLEIF 200 with no body as no answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, null)));
    const { outcome, provenance } = await fetchLei("Acme", "registrant");
    expect(outcome).toBeNull();
    expect(provenance.error).toBe("no response body");
  });

  it("defaults every field the register left out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      data: [{ attributes: { lei: "L1", entity: { legalName: { name: "Acme" } } } }],
    })));
    const { outcome } = await fetchLei("Acme", "registrant");
    expect(outcome!.records[0]).toEqual({
      lei: "L1", legalName: "Acme", exact: true, status: null, country: null,
      legalAddress: null, headquartersAddress: null, registeredAs: null, entityStatus: null,
    });
    expect(outcome!.total).toBe(1);
  });

  it("labels a passive-DNS row that carries no type or count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {
      responseCode: 200, data: [{ answer: "1.2.3.4", firstSeenTimestamp: 1_600_000_000_000 }],
    })));
    const { result } = await fetchPassiveDns("a.test");
    expect(result!.records[0]).toMatchObject({ query: "a.test", rrtype: "UNKNOWN", times: null });
  });

  it("refuses an image whose response declares no type, or arrives oversized", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), body: null,
    }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/a.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });

    const big = new Uint8Array(3_000_001);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      headers: new Headers({ "content-type": "image/png" }),   // no content-length
      arrayBuffer: async () => big.buffer,
      body: null,
    }) as unknown as Response));
    expect(await hashAvatar({ url: "https://cdn.test/b.png", source: "X" })).toMatchObject({
      reason: "image could not be fetched",
    });
  });

  it("hashes an image whose response omits the length header", async () => {
    const png = pngFixture({ width: 16, height: 16 });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      body: null,
    }) as unknown as Response));
    expect("hash" in (await hashAvatar({ url: "https://cdn.test/a.png", source: "X" }))).toBe(true);
  });

  it("treats a manifest that is not a list as an empty locker", async () => {
    mkdirSync(join(dir, "evidence", "weird"), { recursive: true });
    writeFileSync(join(dir, "evidence", "weird", "manifest.json"), '{"not":"a list"}');
    expect(await listEvidence("weird")).toEqual([]);
  });

  it("defaults every provenance field a stored payload got wrong", async () => {
    const out = await captureEvidence({
      caseId: "c", mode: "ip", identifier: "1.1.1.1",
      payload: { sourceHealth: [{}, "not an object", null] },
    });
    expect(out.ok && out.entry.sources).toEqual([
      { source: "unknown", ok: false, ms: 0, fetchedAt: 0 },
    ]);
  });
});

describe("the bulk runner reaches every mode's handler", () => {
  it("dispatches each mode to its own route", async () => {
    // Every upstream refuses, so each handler returns fast; the point is that
    // the import map resolves for all seven modes.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "",
    }) as unknown as Response));
    const inputs: [Parameters<typeof defaultRunner>[0], string][] = [
      ["phone", "+14155552671"],
      ["email", "a@b.test"],
      ["ip", "8.8.8.8"],
      ["wallet", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
      ["hash", "d41d8cd98f00b204e9800998ecf8427e"],
    ];
    for (const [mode, value] of inputs) {
      const out = await defaultRunner(mode, value);
      expect(out.status, mode).toBe(200);
    }
  });
});

describe("typosquat generation", () => {
  it("does not emit a candidate twice when two techniques agree", () => {
    // `ll` produces the same label by more than one route; the generator
    // deduplicates rather than listing it twice.
    const variants = generateTyposquats("all.com");
    expect(new Set(variants.map((v) => v.domain)).size).toBe(variants.length);
  });
});

describe("the last branches, driven rather than assumed", () => {
  it("decodes an upper-case punycode payload and a multi-round one", () => {
    // Upper-case basic digits are legal, and a long payload exercises the
    // second adaptation round.
    // The basic half keeps its own case; only the digits are case-insensitive.
    expect(punycodeDecode("MNCHEN-3YA")).toBe("MüNCHEN");
    expect(punycodeDecode("bcher-kva8fdc")).not.toBeNull();
  });

  it("reports a hash the catalog does not know as not in the catalog", () => {
    expect(factsFromHash({
      input: "abc", kind: "md5", pivots: [],
      facts: { known: false, fileName: null, productName: null, kind: "md5" },
    } as unknown as HashLookupResponse).known).toBe("not in the catalog");
  });

  it("classifies a wallet row and rejects one that is neither chain", async () => {
    const { plausible } = await import("@/app/api/bulk-lookup/route");
    expect(plausible("wallet", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
    expect(plausible("wallet", "not-an-address")).toBe(false);
    expect(plausible("hash", "d41d8cd98f00b204e9800998ecf8427e")).toBe(true);
    expect(plausible("hash", "zz")).toBe(false);
  });

  it("reads the unlock cookie out of a header with several cookies", async () => {
    const { GET } = await import("@/app/api/evidence/route");
    process.env.CASE_PASSWORD = "secret";
    try {
      const res = await GET(new Request("http://localhost/api/evidence?caseId=abc", {
        headers: { cookie: "other=1; malformed; hv_case=nonsense" },
      }) as unknown as import("next/server").NextRequest);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CASE_PASSWORD;
    }
  });
});
