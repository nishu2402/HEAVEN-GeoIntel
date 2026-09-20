import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST as typosquatPOST, ageInDays } from "@/app/api/typosquat-scan/route";
import { POST as sweepPOST, sweepSites } from "@/app/api/username-sweep/route";
import { restoreRateLimit, resetServerState, SUITE_DATA_DIR } from "./testUtils";
import { lookup } from "node:dns/promises";

// The two on-demand endpoints: resolving generated look-alikes, and the deep
// username sweep. Both are explicitly started by the analyst because both are
// hundreds of requests.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-ondemand-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.HV_DATA_DIR = SUITE_DATA_DIR;
});
// mockReset puts back the setup file's default DNS answer (one public address).
afterEach(() => { vi.unstubAllGlobals(); restoreRateLimit(); resetServerState(); vi.mocked(lookup).mockReset(); });

const post = (h: (r: NextRequest) => Promise<Response>, url: string, body: unknown) =>
  h(new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as NextRequest);

const dohAnswer = (type: number, data: string) => ({
  ok: true, status: 200, headers: new Headers(),
  json: async () => ({ Status: 0, Answer: [{ name: "x", type, TTL: 60, data }] }),
}) as unknown as Response;

/**
 * The DoH question a mocked fetch was handed, read out of the query string.
 *
 * Not `url.includes("wordpres.com")`: a look-alike domain can sit anywhere in a
 * URL — in a path, in another parameter, as a prefix of a longer host — and a
 * mock that answers on a substring is answering a different question from the
 * one the code asked (CodeQL js/incomplete-url-substring-sanitization).
 */
const dohQuestion = (u: string | URL) => {
  const q = new URL(String(u)).searchParams;
  return { name: q.get("name") ?? "", type: q.get("type") ?? "" };
};

const empty = () => ({
  ok: true, status: 200, headers: new Headers(), json: async () => ({ Status: 0 }),
}) as unknown as Response;

describe("POST /api/typosquat-scan", () => {
  it("reports only the candidates that resolve, with mail and registration age", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      // One look-alike resolves and takes mail; everything else does not exist.
      const asked = dohQuestion(u);
      if (asked.name === "wordpres.com" && asked.type === "A") return dohAnswer(1, "5.6.7.8");
      if (asked.name === "wordpres.com" && asked.type === "MX") return dohAnswer(15, "10 mail.evil.test");
      if (s.includes("rdap")) {
        return {
          ok: true, status: 200, headers: new Headers(),
          json: async () => ({ events: [{ eventAction: "registration", eventDate: new Date(Date.now() - 86_400_000 * 4).toISOString() }] }),
        } as unknown as Response;
      }
      return empty();
    }));

    const res = await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "wordpress.com", limit: 40 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.generated).toBeGreaterThan(40);
    expect(json.checked).toBe(40);
    expect(json.resolving).toBe(1);
    expect(json.withMail).toBe(1);
    const hit = json.findings[0];
    expect(hit.domain).toBe("wordpres.com");
    expect(hit.addresses).toEqual(["5.6.7.8"]);
    expect(hit.mx).toEqual(["mail.evil.test"]);
    expect(hit.ageDays).toBeLessThan(10);   // registered days ago: a live campaign
    expect(json.findings).toHaveLength(1);  // candidates that do not exist are not findings
  });

  it("retries the queries that got no answer, and counts what is still unknown", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      // Every DoH query fails, so the retry pass runs and the count is honest.
      return { ok: false, status: 503, headers: new Headers(), json: async () => ({}) } as unknown as Response;
    }));
    const json = await (await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "a.com", limit: 4 })).json();
    expect(json.unanswered).toBe(4);
    expect(json.resolving).toBe(0);
    expect(json.findings).toEqual([]);
    expect(calls).toBeGreaterThan(8);  // 4 candidates × A+MX, plus the retry pass
    expect(json.sourceHealth[0].ok).toBe(false);
  });

  it("accepts an internationalised target and rejects a non-domain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => empty()));
    const ok = await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "münchen.de", limit: 2 });
    expect((await ok.json()).domain).toBe("xn--mnchen-3ya.de");

    const bad = await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "not a domain!!" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe("domain");
  });

  it("measures registration age in whole days, and says nothing without a date", () => {
    expect(ageInDays(null)).toBeNull();
    expect(ageInDays("not a date")).toBeNull();
    expect(ageInDays("2026-09-01T00:00:00Z", Date.parse("2026-09-11T00:00:00Z"))).toBe(10);
  });
});

describe("POST /api/username-sweep", () => {
  it("classifies a page against each site's own contract", async () => {
    const sites = sweepSites();
    expect(sites.length).toBeGreaterThan(100);
    const first = sites[0];

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: first.ec,
      headers: new Headers(),
      text: async () => first.es ?? "",
    }) as unknown as Response));

    const res = await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 3 });
    const json = await res.json();
    expect(json.offset).toBe(0);
    expect(json.limit).toBe(3);
    expect(json.total).toBe(sites.length);
    expect(json.nextOffset).toBe(3);
    expect(json.hits).toHaveLength(3);
    expect(json.found + json.notfound + json.unknown).toBe(3);
    expect(json.sourceHealth[0].source).toBe("usernameDeepSweep");
  });

  it("says a page is unknown rather than absent when every probe is walled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 403, headers: new Headers(), text: async () => "Cloudflare",
    }) as unknown as Response));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 2 })).json();
    expect(json.unknown).toBe(2);
    expect(json.found).toBe(0);
    expect(json.sourceHealth[0].ok).toBe(false);
    expect(json.sourceHealth[0].error).toMatch(/no site returned a classifiable answer/);
  });

  it("never probes a catalog site whose name resolves inward", async () => {
    // Hundreds of third-party domains: one that lapses and is re-registered
    // pointing at 127.0.0.1 must not receive this request.
    vi.mocked(lookup).mockImplementation(async () => [{ address: "127.0.0.1", family: 4 }] as never);
    const spy = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => "x" }) as unknown as Response);
    vi.stubGlobal("fetch", spy);
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 3 })).json();
    expect(json.hits.map((h: { status: string }) => h.status)).toEqual(["unknown", "unknown", "unknown"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not follow a site's redirect into the metadata service", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      seen.push(String(u));
      return { ok: false, status: 302, headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }), text: async () => "" } as unknown as Response;
    }));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 2 })).json();
    expect(json.hits.every((h: { status: string }) => h.status === "unknown")).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("records a body that dies midway as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), text: async () => { throw new TypeError("terminated"); },
    }) as unknown as Response));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 2 })).json();
    expect(json.hits.every((h: { status: string; httpStatus?: number }) => h.status === "unknown" && h.httpStatus === undefined)).toBe(true);
  });

  it("records an unreachable site as unknown, never as a claim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", { username: "torvalds", limit: 2 })).json();
    expect(json.hits.every((h: { status: string }) => h.status === "unknown")).toBe(true);
    expect(json.hits[0].httpStatus).toBeUndefined();
  });

  it("pages to the end and then stops", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 404, headers: new Headers(), text: async () => "",
    }) as unknown as Response));
    const total = sweepSites().length;
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", {
      username: "torvalds", offset: total - 1, limit: 5,
    })).json();
    expect(json.hits).toHaveLength(1);
    expect(json.nextOffset).toBeNull();
  });

  it("offers the unvalidated sites separately, and counts them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 404, headers: new Headers(), text: async () => "",
    }) as unknown as Response));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", {
      username: "torvalds", limit: 1, includeUnvalidated: true,
    })).json();
    expect(json.total).toBe(sweepSites(true).length);
    expect(json.unvalidated).toBeGreaterThan(0);
    expect(sweepSites(true).length).toBeGreaterThan(sweepSites(false).length);
  });

  it("rejects a handle no site could hold", async () => {
    const res = await post(sweepPOST, "http://localhost/api/username-sweep", { username: "a b!" });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("username");
  });
});

describe("the remaining branches of both on-demand routes", () => {
  it("recovers a candidate on the retry pass", async () => {
    // First pass: the resolver refuses everything. Retry: it answers, and the
    // candidate that was "unknown" becomes a finding.
    let pass = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("rdap")) return empty();
      pass++;
      // Four queries in the first pass (2 candidates × A+MX), then answers.
      if (pass <= 4) return { ok: false, status: 503, headers: new Headers(), json: async () => ({}) } as unknown as Response;
      return s.includes("type=A") ? dohAnswer(1, "9.9.9.9") : empty();
    }));
    const json = await (await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "ab.com", limit: 2 })).json();
    expect(json.unanswered).toBe(0);
    expect(json.resolving).toBe(2);
  });

  it("treats a resolver that throws as no answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket"); }));
    const json = await (await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "ab.com", limit: 1 })).json();
    expect(json.unanswered).toBe(1);
  });

  it("ignores an RDAP answer that carries no registration date", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      const s = String(u);
      if (s.includes("type=A")) return dohAnswer(1, "1.1.1.1");
      if (s.includes("rdap")) return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) } as unknown as Response;
      return empty();
    }));
    const json = await (await post(typosquatPOST, "http://localhost/api/typosquat-scan", { domain: "ab.com", limit: 1 })).json();
    expect(json.findings[0].whois).toBeNull();
    expect(json.findings[0].ageDays).toBeNull();
  });

  it("clamps an offset past the end of the catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 404, headers: new Headers(), text: async () => "",
    }) as unknown as Response));
    const json = await (await post(sweepPOST, "http://localhost/api/username-sweep", {
      username: "torvalds", offset: 5000, limit: 5,
    })).json();
    expect(json.hits).toEqual([]);
    expect(json.nextOffset).toBeNull();
  });
});
