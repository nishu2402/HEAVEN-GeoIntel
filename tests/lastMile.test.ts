import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { buildPhoneReport, buildEmailReport, buildUsernameReport, buildDomainReport } from "@/lib/analysis/report";
import { resolveIdentity } from "@/lib/analysis/identityResolve";
import { startJob, getJob, cancelJob, resetJobs, summarize } from "@/lib/server/bulkJobs";
import { parseBtcActivity } from "@/lib/analysis/walletActivity";
import { generateTyposquats } from "@/lib/analysis/typosquat";
import { fetchPassiveDns } from "@/lib/server/passiveDns";
import { fetchLei } from "@/lib/server/gleif";
import { restoreRateLimit, resetServerState, useRateLimit, clientCookie } from "./testUtils";
import type { DomainLookupResponse, EmailLookupResponse, LookupResponse, UsernameLookupResponse } from "@/lib/types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-lastmile-"));
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

describe("reports on a response that predates the new fields", () => {
  it("omits the exposure row a cached phone or email result never carried", () => {
    const phone = buildPhoneReport({
      input: { raw: "+1", e164: "+14155552671", national: "", country: "US", countryCallingCode: "+1", region: null, isValid: true, isPossible: true, type: null },
      analysis: { countryName: "United States", timezones: [], utcOffsets: [] } as never,
      countryIntel: null, offline: { riskScore: 0, signals: [], summary: "" } as never,
      sources: {} as never,
      aggregated: { carrier: null, lineType: null, countryName: "United States" } as never,
      threatScore: 0, threatLabel: "CLEAN",
    } as unknown as LookupResponse);
    expect(phone.summary?.some((r) => r.label === "Exposure")).toBe(false);

    const email = buildEmailReport({
      email: "a@b.test",
      analysis: { email: "a@b.test", username: "a", domain: "b.test", domainUnicode: "b.test", tld: "test", isValidFormat: true, providerType: "corporate", providerName: "B", isDisposable: false, isWebmail: false, isPrivacyFocused: false, isRoleAddress: false, guessedName: null },
      gravatar: { found: false, displayName: null, preferredUsername: null, aboutMe: null, currentLocation: null, profileUrl: null, thumbnailUrl: null, accounts: [], verifiedAccounts: [] },
      emailrep: { ok: false }, hunter: { ok: false }, abstract: { ok: false }, xon: { ok: false },
      breachDirectory: { ok: false }, fullContact: { ok: false }, hudsonRock: { ok: false },
      leakCheck: { ok: false }, comb: { ok: false }, hibp: { ok: false },
    } as unknown as EmailLookupResponse);
    expect(email.summary?.some((r) => r.label === "Exposure")).toBe(false);
  });

  it("renders a resolved identity that has a location but no name", () => {
    const m = buildUsernameReport({
      username: "u", checked: 1, found: 0, hits: [], profiles: [],
      identity: { names: [], locations: [], avatars: [], bios: [] },
      resolvedIdentity: {
        name: null, location: { value: "Berlin", sources: ["x"], agreement: 1, total: 1 }, avatar: null,
        confidence: 15, label: "low", cluster: { platforms: ["X"], proofs: [] }, unlinked: [], conflicts: [],
      },
      pivots: [], leakCheck: { ok: false }, hudsonRock: { ok: false },
    } as unknown as UsernameLookupResponse);
    expect(JSON.stringify(m.sections)).toContain("Berlin");
  });

  it("prints a passive-DNS record that carries no dates", () => {
    const m = buildDomainReport({
      domain: "a.test", isValid: true,
      dns: { a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] },
      whois: null, subdomains: [],
      passiveDns: { records: [{ query: "a.test", answer: "1.1.1.1", rrtype: "A", firstSeen: null, lastSeen: null, times: null }], total: 1, capped: false, degraded: false },
      emailSecurity: { hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: false },
      dnssec: null, wayback: null, http: null, pivots: [],
    } as unknown as DomainLookupResponse);
    expect(JSON.stringify(m.sections)).toContain("A a.test → 1.1.1.1");
  });
});

describe("identity: an avatar from an account nothing links", () => {
  it("lists it as an unlinked candidate rather than as the subject's photo", () => {
    const r = resolveIdentity({
      names: [{ value: "Ada", source: "GitHub" }],
      locations: [],
      avatars: [{ url: "https://cdn/other.png", source: "Chess.com" }],
      bios: [],
    });
    expect(r.avatar).toBeNull();
    expect(r.unlinked).toEqual([
      { field: "avatar", value: "https://cdn/other.png", source: "Chess.com" },
    ]);
  });
});

describe("the job runner's remaining paths", () => {
  it("stops starting rows once a job is cancelled", async () => {
    const started: string[] = [];
    const job = startJob({
      rows: Array.from({ length: 6 }, (_, i) => ({ mode: "domain" as const, value: `d${i}.test` })),
      concurrency: 1,
      runner: async (mode, value) => {
        started.push(value);
        await new Promise((r) => setTimeout(r, 10));
        return { status: 200, body: { domain: value } };
      },
    });
    await new Promise((r) => setTimeout(r, 15));
    cancelJob(job.id);
    await new Promise((r) => setTimeout(r, 60));
    // The rows already in flight finished; the rest were never started.
    expect(started.length).toBeLessThan(6);
    expect(getJob(job.id)!.state).toBe("cancelled");
  });

  it("defaults a provenance row whose source name is not a string", () => {
    const job = { id: "x", state: "done" as const, total: 0, done: 0, rows: [], startedAt: 0 };
    expect(job.rows).toEqual([]);
    expect(summarize("ip", { sourceHealth: [{ source: 42, ok: true }] })).toBeTruthy();
  });
});

describe("small parsers on malformed values", () => {
  it("ignores a block time that is not a number", () => {
    const out = parseBtcActivity("me", [
      { status: { block_time: "yesterday" as unknown as number }, vout: [] },
    ], 1);
    expect(out!.lastActivity).toBeNull();
  });

  it("does not emit the same IDN candidate twice", () => {
    // `oo` yields the same A-label from two positions; the generator dedupes.
    const variants = generateTyposquats("oo.com");
    expect(new Set(variants.map((v) => v.domain)).size).toBe(variants.length);
  });

  it("treats a passive-DNS body with no data array as empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { responseCode: 200, count: 0 })));
    const { result } = await fetchPassiveDns("a.test");
    expect(result!.records).toEqual([]);
  });

  it("treats a GLEIF body with no data array as no records", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { meta: {} })));
    const { outcome } = await fetchLei("Acme", "registrant");
    expect(outcome!.records).toEqual([]);
  });
});

describe("routes: quota and query-string edges", () => {
  it("404s a bulk progress request with no job id", async () => {
    const { GET, DELETE } = await import("@/app/api/bulk-lookup/route");
    expect((await GET(new Request("http://localhost/api/bulk-lookup") as unknown as NextRequest)).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/bulk-lookup", { method: "DELETE" }) as unknown as NextRequest)).status).toBe(404);
  });

  it("429s the on-demand endpoints once the window is spent", async () => {
    const { POST: sweepPOST } = await import("@/app/api/username-sweep/route");
    const { POST: typosquatPOST } = await import("@/app/api/typosquat-scan/route");
    const { POST: evidencePOST } = await import("@/app/api/evidence/route");
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "" }) as unknown as Response));

    useRateLimit(1);
    const cookie = clientCookie("ondemand");
    const call = (h: (r: NextRequest) => Promise<Response>, url: string, body: unknown) =>
      h(new Request(url, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }) as unknown as NextRequest);

    expect((await call(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 1 })).status).toBe(200);
    expect((await call(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 1 })).status).toBe(429);
    expect((await call(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "a.com", limit: 1 })).status).toBe(429);
    expect((await call(evidencePOST, "http://localhost/api/evidence", { action: "verify", caseId: "x" })).status).toBe(429);
  });

  it("reads a SERVFAIL as no answer during a typosquat scan", async () => {
    const { POST: typosquatPOST } = await import("@/app/api/typosquat-scan/route");
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ Status: 2 }) }) as unknown as Response));
    const res = await typosquatPOST(new Request("http://localhost/api/typosquat-scan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "a.com", limit: 2 }),
    }) as unknown as NextRequest);
    const body = await res.json();
    expect(body.unanswered).toBe(2);
  });

  it("captures evidence that names neither a mode nor an identifier", async () => {
    const { POST: evidencePOST } = await import("@/app/api/evidence/route");
    const res = await evidencePOST(new Request("http://localhost/api/evidence", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "capture", caseId: "bare", payload: { a: 1 } }),
    }) as unknown as NextRequest);
    expect((await res.json()).entry.mode).toBe("unknown");
  });

  it("serves an unlocked locker to a request carrying a valid token", async () => {
    const { GET } = await import("@/app/api/evidence/route");
    const { issueToken, CASE_TOKEN_COOKIE } = await import("@/lib/server/caseLock");
    process.env.CASE_PASSWORD = "secret";
    try {
      const { token } = issueToken("secret");
      const res = await GET(new Request("http://localhost/api/evidence?caseId=abc", {
        headers: { cookie: `${CASE_TOKEN_COOKIE}=${token}` },
      }) as unknown as NextRequest);
      expect(res.status).toBe(200);
    } finally {
      delete process.env.CASE_PASSWORD;
    }
  });
});

describe("the very last branches", () => {
  it("queries the legal-entity register with the WHOIS registrant when there is one", async () => {
    const { POST: domainPOST } = await import("@/app/api/domain-lookup/route");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("rdap")) {
        return json(200, {
          entities: [{
            roles: ["registrant"],
            vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Automattic Inc."]]],
          }],
        });
      }
      if (s.includes("gleif")) {
        return json(200, { data: [{ attributes: { lei: "L1", entity: { legalName: { name: "Automattic Inc." } } } }] });
      }
      return { ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "" } as unknown as Response;
    }));
    const res = await domainPOST(new Request("http://localhost/api/domain-lookup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "wordpress.org" }),
    }) as unknown as NextRequest);
    const body = await res.json();
    expect(body.lei?.source).toBe("registrant");
  });

  it("runs both on-demand scans with their default page size", async () => {
    const { POST: typosquatPOST } = await import("@/app/api/typosquat-scan/route");
    const { POST: sweepPOST } = await import("@/app/api/username-sweep/route");
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("cloudflare-dns")) {
        return json(200, s.includes("type=MX")
          ? { Status: 0, Answer: [{ name: "x", type: 15, TTL: 60, data: "10 mail.test" }] }
          : { Status: 0 });
      }
      return { ok: true, status: 404, headers: new Headers(), text: async () => "", json: async () => ({}) } as unknown as Response;
    }));

    // No `limit`: both endpoints fall back to their own default.
    const squat = await (await typosquatPOST(new Request("http://localhost/api/typosquat-scan", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "ab.com" }),
    }) as unknown as NextRequest)).json();
    // Mail with no addresses still counts as resolving: the name takes email.
    expect(squat.withMail).toBeGreaterThan(0);
    expect(squat.resolving).toBeGreaterThan(0);

    const sweep = await (await sweepPOST(new Request("http://localhost/api/username-sweep", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "torvalds" }),
    }) as unknown as NextRequest)).json();
    expect(sweep.limit).toBe(60);
  });

  it("reads a cookie header that carries no unlock token", async () => {
    const { GET } = await import("@/app/api/evidence/route");
    process.env.CASE_PASSWORD = "secret";
    try {
      const res = await GET(new Request("http://localhost/api/evidence?caseId=abc", {
        headers: { cookie: "theme=dark; other=1" },
      }) as unknown as NextRequest);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.CASE_PASSWORD;
    }
  });

  it("flattens a bulk row's provenance even when the source name is not a string", async () => {
    const job = startJob({
      rows: [{ mode: "domain", value: "a.test" }],
      runner: async () => ({ status: 200, body: { sourceHealth: [{ source: 42, ok: "yes", ms: "slow", fetchedAt: null }] } }),
    });
    for (let i = 0; i < 100 && getJob(job.id)?.state === "running"; i++) await new Promise((r) => setTimeout(r, 5));
    expect(getJob(job.id)!.rows[0].sources).toEqual([{ source: "unknown", ok: false }]);
  });

  it("dispatches a username row to the username route", async () => {
    const { defaultRunner } = await import("@/lib/server/bulkJobs");
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: false, status: 503, headers: new Headers(), json: async () => ({}), text: async () => "" }) as unknown as Response));
    const out = await defaultRunner("username", "torvalds");
    expect(out.status).toBe(200);
  });

  it("gives up on passive DNS when the retry also comes back flattened", async () => {
    const flattened = {
      responseCode: 200, count: 6,
      data: Array.from({ length: 6 }, () => ({ answer: "host.test", rrtype: "a", firstSeenTimestamp: 0, lastSeenTimestamp: 0 })),
    };
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      // The retry fails outright, so the first (degraded) answer stands.
      return call === 1 ? json(200, flattened) : json(503, {});
    }));
    const { result } = await fetchPassiveDns("a.test");
    expect(result!.degraded).toBe(true);
    expect(result!.records[0].rrtype).toBe("UNKNOWN");
  });
});
