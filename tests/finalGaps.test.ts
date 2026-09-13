import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { punycodeDecode } from "@/lib/analysis/idn";
import { parseBtcActivity } from "@/lib/analysis/walletActivity";
import { parseBody } from "@/lib/server/validation";
import { fetchPassiveDns } from "@/lib/server/passiveDns";
import { startJob, getJob, jobCsv, resetJobs } from "@/lib/server/bulkJobs";
import { buildPhoneReport, buildDomainReport } from "@/lib/analysis/report";
import { restoreRateLimit, resetServerState } from "./testUtils";
import type { DomainLookupResponse, LookupResponse } from "@/lib/types";

// The certificate half of the legal-entity lookup needs a TLS probe result, and
// the probe talks to a socket. Only probeHttp is replaced; the SSRF guard beside
// it stays real, because the route depends on it.
vi.mock("@/lib/server/httpProbe", async (orig) => {
  const actual = await orig<typeof import("@/lib/server/httpProbe")>();
  return {
    ...actual,
    probeHttp: async () => ({
      finalUrl: "https://paypal.com/", status: 200, chain: [], headers: {}, title: null,
      server: null, poweredBy: null, cookies: [], securityHeaders: {}, technologies: [],
      httpsRedirect: true,
      tls: {
        protocol: "TLSv1.3", cipher: null, issuer: "DigiCert Inc", subject: "www.paypal.com",
        subjectOrg: "PayPal, Inc.", subjectJurisdiction: "US", subjectRegistrationNumber: "3014267",
        altNames: [], validFrom: null, validTo: null, daysRemaining: null, trusted: true, trustError: null,
      },
    }),
  };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-gaps-"));
  process.env.HV_DATA_DIR = dir;
  resetJobs();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  vi.unstubAllGlobals();
  restoreRateLimit();
  resetServerState();
});

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body,
}) as unknown as Response;
const dead = { ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "" } as unknown as Response;

describe("punycode: the delta guard the RFC puts before the code point", () => {
  it("refuses a payload whose delta lands past the code-point ceiling", () => {
    // Built against the reference algorithm rather than guessed: eight digits
    // that drive `i` to 2,147,483,520 on the first code point, one above what
    // can still be added to the initial n. A fuzz of 600k random payloads never
    // produces one, which is why this is constructed.
    expect(punycodeDecode("9016146o")).toBeNull();
  });
});

describe("a numeric field an upstream can still get wrong", () => {
  it("reads a block time of 1e400 as no date rather than crashing on it", () => {
    // JSON has no Infinity, but `JSON.parse` produces one from an over-large
    // literal, and `new Date(Infinity).toISOString()` throws.
    const body = JSON.parse('[{"status":{"confirmed":true,"block_time":1e400},"vout":[]}]');
    const out = parseBtcActivity("me", body, 1)!;
    expect(out.lastActivity).toBeNull();
    expect(out.sampled).toBe(1);
  });
});

describe("validation messages", () => {
  it("pluralises the minimum when a list schema asks for more than one entry", async () => {
    const schema = z.object({ items: z.array(z.string()).min(2) });
    const req = new Request("http://localhost/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: ["only-one"] }),
    });
    const parsed = await parseBody(req, schema);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.problem.error).toContain("needs at least 2 entries");
  });
});

describe("passive DNS: a retry that answers with nothing at all", () => {
  it("takes the empty retry over the flattened first answer", async () => {
    const flattened = {
      responseCode: 200, count: 6,
      data: Array.from({ length: 6 }, () => ({ answer: "host.test", rrtype: "a", firstSeenTimestamp: 0, lastSeenTimestamp: 0 })),
    };
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      // The retry is well-formed but carries no rows, which is not degraded:
      // it is an answer of "nothing recorded".
      return call === 1 ? json(200, flattened) : json(200, { responseCode: 200, count: 0 });
    }));
    const { result } = await fetchPassiveDns("a.test");
    expect(result!.degraded).toBe(false);
    expect(result!.records).toEqual([]);
  });
});

describe("bulk CSV", () => {
  it("keeps two rows of one mode under a single column set", async () => {
    const job = startJob({
      rows: [{ mode: "domain", value: "a.test" }, { mode: "domain", value: "b.test" }],
      runner: async (_mode, value) => ({ status: 200, body: { domain: value } }),
    });
    for (let i = 0; i < 200 && getJob(job.id)?.state === "running"; i++) await new Promise((r) => setTimeout(r, 5));
    const csv = jobCsv(getJob(job.id)!);
    // One header, two rows, one block: the second row joined the first mode's
    // column set instead of opening its own.
    expect(csv.split("\n\n")).toHaveLength(1);
    expect(csv.split("\n").filter((l) => l.startsWith("mode,input,"))).toHaveLength(1);
    expect(csv).toContain("a.test");
    expect(csv).toContain("b.test");
  });
});

describe("report rows an older or thinner response produces", () => {
  it("prints an exposure score that arrived without its label", () => {
    const m = buildPhoneReport({
      input: { raw: "+1", e164: "+14155552671", national: "", country: "US", countryCallingCode: "+1", region: null, isValid: true, isPossible: true, type: null },
      analysis: { countryName: "United States", timezones: [], utcOffsets: [] } as never,
      countryIntel: null, offline: { riskScore: 0, signals: [], summary: "" } as never,
      sources: {} as never,
      aggregated: { carrier: null, lineType: null, countryName: "United States" } as never,
      threatScore: 0, threatLabel: "CLEAN", exposureScore: 46,
    } as unknown as LookupResponse);
    expect(m.summary?.find((r) => r.label === "Exposure")?.value).toBe("46/100");
  });

  it("reads a passive-DNS pair that was never seen again as current", () => {
    const m = buildDomainReport({
      domain: "a.test", isValid: true,
      dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
      whois: null, subdomains: [],
      passiveDns: {
        records: [{ query: "a.test", answer: "1.1.1.1", rrtype: "A", firstSeen: "2019-04-02", lastSeen: null, times: 3 }],
        total: 1, capped: false, degraded: false,
      },
      emailSecurity: { hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: false },
      dnssec: null, wayback: null, http: null, pivots: [],
    } as unknown as DomainLookupResponse);
    expect(JSON.stringify(m.sections)).toContain("(2019-04-02 to now)");
  });
});

describe("routes: the last unwalked paths", () => {
  it("asks the legal-entity register with the certificate's organisation when WHOIS is redacted", async () => {
    const { POST } = await import("@/app/api/domain-lookup/route");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("cloudflare-dns") && s.includes("type=A")) {
        return json(200, { Status: 0, Answer: [{ name: "paypal.com", type: 1, TTL: 60, data: "151.101.1.140" }] });
      }
      // A GDPR-redacted registration: a real record, no registrant name in it.
      if (s.includes("rdap")) return json(200, { entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]] }] });
      if (s.includes("gleif")) {
        return json(200, { data: [{ attributes: { lei: "LBQ3CAGQB6M55WHL3G85", entity: { legalName: { name: "PayPal, Inc." }, legalAddress: { country: "US" }, status: "ACTIVE" }, registration: { status: "ISSUED" } } }] });
      }
      return dead;
    }));
    const res = await POST(new Request("http://localhost/api/domain-lookup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "paypal.com" }),
    }) as unknown as NextRequest);
    const body = await res.json();
    expect(body.lei?.source).toBe("certificate");
    expect(body.lei?.records[0]?.lei).toBe("LBQ3CAGQB6M55WHL3G85");
  });

  it("rejects an evidence manifest request that names no case at all", async () => {
    const { GET } = await import("@/app/api/evidence/route");
    const res = await GET(new Request("http://localhost/api/evidence") as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("caseId");
  });

  it("counts a look-alike that only answers for mail as resolving, on the retry", async () => {
    const { POST } = await import("@/app/api/typosquat-scan/route");
    let aCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (!s.includes("cloudflare-dns")) return dead;
      if (s.includes("type=MX")) {
        return json(200, { Status: 0, Answer: [{ name: "x", type: 15, TTL: 60, data: "10 mail.test" }] });
      }
      // The first A query is throttled away; the retry answers, with nothing.
      aCalls++;
      return aCalls === 1 ? dead : json(200, { Status: 0 });
    }));
    const res = await POST(new Request("http://localhost/api/typosquat-scan", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "ab.com", limit: 1 }),
    }) as unknown as NextRequest);
    const body = await res.json();
    expect(body.unanswered).toBe(0);
    expect(body.resolving).toBe(1);
    expect(body.findings[0].addresses).toEqual([]);
    expect(body.findings[0].mx).toEqual(["mail.test"]);
  });

  it("sweeps the whole catalog when none of it has been validated", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data/extendedUsernameSites", () => ({
      EXTENDED_USERNAME_SITES: [
        { n: "Unvalidated", c: "social", u: "https://u.test/{account}", ec: 200, es: "profile", mc: 404, ms: "no user" },
        { n: "GitHub", c: "coding", u: "https://github.com/{account}", ec: 200, es: "x", mc: 404, ms: "y" },
      ],
    }));
    try {
      const { sweepSites } = await import("@/app/api/username-sweep/route");
      // GitHub is already covered by the fast sweep; the other site is unvalidated
      // and still swept, because gating on `v` would sweep nothing.
      expect(sweepSites().map((s) => s.n)).toEqual(["Unvalidated"]);
      expect(sweepSites(true).map((s) => s.n)).toEqual(["Unvalidated"]);
    } finally {
      vi.doUnmock("@/lib/data/extendedUsernameSites");
      vi.resetModules();
    }
  });
});
