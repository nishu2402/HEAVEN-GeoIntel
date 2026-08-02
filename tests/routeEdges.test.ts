import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST as bulkPOST } from "@/app/api/bulk-lookup/route";
import { POST as casesPOST } from "@/app/api/cases/route";
import { POST as domainPOST } from "@/app/api/domain-lookup/route";
import { POST as ipPOST } from "@/app/api/ip-lookup/route";
import { POST as usernamePOST } from "@/app/api/username-lookup/route";
import { GET as sourcesGET } from "@/app/api/sources/route";
import { setCached } from "@/lib/server/cache";
import { setKey } from "@/lib/server/keyStore";
import { mark, resetHealth } from "@/lib/server/sourceHealth";
import { restoreRateLimit } from "./testUtils";
import type { LookupResponse } from "@/lib/types";

// Error and edge paths across the remaining routes — the branches that only run
// when an upstream misbehaves, which is exactly what the old gate never checked.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-routeedges-"));
  process.env.HV_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreRateLimit();
  resetHealth();
});

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

const post = <T,>(handler: (r: NextRequest) => Promise<T>, url: string, body: unknown) =>
  handler(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest);

describe("bulk-lookup row classification", () => {
  it("labels an empty row and an unparseable row", async () => {
    const res = await post(bulkPOST, "http://localhost/api/bulk-lookup", {
      numbers: ["   ", "nonsense", "+14155552671"],
    });
    const { rows } = await res.json();
    expect(rows[0]).toEqual({ input: "", ok: false, error: "Empty input" });
    expect(rows[1]).toEqual({ input: "nonsense", ok: false, error: "Unparseable" });
    expect(rows[2].ok).toBe(true);
  });

  it("rejects a non-string entry at the schema, before the route sees it", async () => {
    const res = await post(bulkPOST, "http://localhost/api/bulk-lookup", { numbers: [42] });
    expect(res.status).toBe(400);
    expect(res.headers.get("X-RateLimit-Limit")).toBeTruthy(); // 400s carry the headers too
  });

  it("serves a cached row without re-analysing, and flags it as cached", async () => {
    const e164 = "+14155559123";
    setCached(e164, {
      aggregated: { carrier: "CachedCarrier", lineType: "mobile", countryName: "United States" },
      analysis: { areaCode: "415" },
    } as unknown as LookupResponse);

    const { rows } = await (await post(bulkPOST, "http://localhost/api/bulk-lookup", { numbers: [e164] })).json();
    expect(rows[0].cached).toBe(true);
    expect(rows[0].carrier).toBe("CachedCarrier");
  });
});

describe("cases route failure handling", () => {
  it("returns a generic 500 without leaking internals when the store throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Point the data dir at a path UNDER an existing file: mkdir then fails
    // with ENOTDIR, which is the closest realistic "the disk said no".
    const prev = process.env.HV_DATA_DIR;
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    process.env.HV_DATA_DIR = join(blocker, "nested");
    try {
      const res = await post(casesPOST, "http://localhost/api/cases", { action: "create", name: "X" });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "Request failed" });
      expect(JSON.stringify(body)).not.toContain("blocker"); // no path leakage
      expect(err).toHaveBeenCalled();
    } finally {
      process.env.HV_DATA_DIR = prev;
    }
  });
});

describe("domain-lookup upstream failures", () => {
  const allFail = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));

  it("still answers 200 with empty sections when every upstream is down", async () => {
    allFail();
    const res = await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "example.test" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dns.a).toEqual([]);
    expect(json.whois).toBeNull();
    expect(json.subdomains).toEqual([]);
    // ...and says so, rather than implying the domain has no records.
    const health = Object.fromEntries(json.sourceHealth.map((h: { source: string; ok: boolean }) => [h.source, h.ok]));
    expect(health).toEqual({ dns: false, whois: false, subdomains: true, wayback: false });
  });

  it("returns [] for a non-2xx DoH response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("cloudflare-dns") ? resp(500, {}) : resp(404, {})));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "e2.test" })).json();
    expect(json.dns.a).toEqual([]);
  });

  it("returns null WHOIS on a non-2xx RDAP response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("rdap.org") ? resp(404, {}) : resp(200, {})));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "e3.test" })).json();
    expect(json.whois).toBeNull();
  });

  it("takes the registrar handle when the RDAP entity has no vCard name", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
      if (String(u).includes("rdap.org")) {
        return resp(200, {
          entities: [
            { roles: ["registrar"], handle: "REG-123" },
            { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Acme Ltd"]]] },
            { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Second Ignored"]]] },
            { roles: [] },
          ],
          events: [{ eventAction: "registration", eventDate: "2001-01-01" }],
          nameservers: [{ ldhName: "NS1.EXAMPLE.TEST" }, {}],
          status: ["active"],
        });
      }
      return resp(404, {});
    }));
    const json = await (await post(domainPOST, "http://localhost/api/domain-lookup", { domain: "e4.test" })).json();
    expect(json.whois.registrar).toBe("REG-123");
    expect(json.whois.registrantOrg).toBe("Acme Ltd"); // first registrant wins
    expect(json.whois.nameservers).toEqual(["ns1.example.test"]);
    expect(json.whois.createdDate).toBe("2001-01-01");
  });
});

describe("ip-lookup upstream failures", () => {
  it("returns a structured failure when the geo source is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const res = await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "8.8.4.4" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ip).toBeNull();
    expect(json.error).toBeTruthy();
    expect(json.threatLabel).toBe("UNKNOWN");
    expect(json.sourceHealth.find((h: { source: string }) => h.source.includes("ip-api")).ok).toBe(false);
  });

  it("surfaces ip-api's own failure message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("ip-api.com")
        ? resp(200, { status: "fail", message: "reserved range" })
        : resp(404, {})));
    const json = await (await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "9.9.9.9" })).json();
    expect(json.error).toBe("reserved range");
  });

  it("falls back to a generic message when ip-api fails without one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("ip-api.com") ? resp(200, { status: "fail" }) : resp(404, {})));
    const json = await (await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "9.9.9.8" })).json();
    expect(json.error).toBe("Lookup failed");
  });

  it("parses an AS string that carries no organisation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("ip-api.com")
        ? resp(200, { status: "success", query: "8.8.8.8", countryCode: "US", as: "AS15169", asname: "GOOGLE" })
        : resp(404, {})));
    const json = await (await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "8.8.8.8" })).json();
    expect(json.ip.asn).toBe(15169);
    expect(json.ip.asnOrg).toBe("GOOGLE"); // falls back to asname
  });

  it("keeps a malformed AS string verbatim rather than dropping it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL) =>
      String(u).includes("ip-api.com")
        ? resp(200, { status: "success", query: "8.8.8.8", countryCode: "US", as: "not-an-as-string" })
        : resp(404, {})));
    const json = await (await post(ipPOST, "http://localhost/api/ip-lookup", { ip: "8.8.8.7" })).json();
    expect(json.ip.asn).toBeNull();
    expect(json.ip.asnOrg).toBe("not-an-as-string");
  });
});

describe("username sweep site probing", () => {
  it("records unknown when a probe throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const json = await (await post(usernamePOST, "http://localhost/api/username-lookup", { username: "probeuser" })).json();
    // Every auto-checked site failed → all unknown, none claimed found.
    expect(json.found).toBe(0);
    expect(json.hits.some((h: { status: string }) => h.status === "unknown")).toBe(true);
    expect(json.sourceHealth.find((h: { source: string }) => h.source === "usernameSweep").ok).toBe(false);
  });

  it("uses the absence marker for body-checked sites", async () => {
    // 200 + the "not found" marker ⇒ notfound; 200 without it ⇒ found.
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {})));
    const json = await (await post(usernamePOST, "http://localhost/api/username-lookup", { username: "bodyuser" })).json();
    expect(json.sourceHealth.find((h: { source: string }) => h.source === "usernameSweep").ok).toBe(true);
    expect(json.hits.some((h: { status: string }) => h.status === "found")).toBe(true);
  });
});

describe("GET /api/sources", () => {
  it("marks a multi-key source unconfigured until every key is present", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    try {
      const json = await (await sourcesGET()).json();
      const twilio = json.sources.find((s: { id: string }) => s.id === "twilio");
      expect(twilio.configured).toBe(false);
      expect(twilio.via).toBeNull();
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID;
    }
  });

  it("reports env vs ui provenance, preferring 'ui' for a mixed pair", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    try {
      let json = await (await sourcesGET()).json();
      expect(json.sources.find((s: { id: string }) => s.id === "twilio").via).toBe("env");

      await setKey("TWILIO_AUTH_TOKEN", "from-ui");
      json = await (await sourcesGET()).json();
      const twilio = json.sources.find((s: { id: string }) => s.id === "twilio");
      expect(twilio.configured).toBe(true);
      expect(twilio.via).toBe("ui"); // weakest/most-recent provenance wins
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
    }
  });

  it("omits lastSeen until a source has actually run", async () => {
    const json = await (await sourcesGET()).json();
    expect(json.sources.every((s: { lastSeen?: unknown }) => s.lastSeen === undefined)).toBe(true);
  });

  it("reports observed health once a source has been used", async () => {
    mark({ source: "hudsonRock", ok: true, ms: 42, fetchedAt: 1234 });
    mark({ source: "ipqs", ok: false, ms: 9, fetchedAt: 5678, error: "NOT_CONFIGURED", skipped: true });
    mark({ source: "gravatar", ok: false, ms: 7, fetchedAt: 999, error: "HTTP 503" });

    const json = await (await sourcesGET()).json();
    const by = (id: string) => json.sources.find((s: { id: string }) => s.id === id);

    expect(by("hudsonRock").lastSeen).toEqual({ ok: true, ms: 42, at: 1234 });
    expect(by("ipqs").lastSeen).toEqual({ ok: false, ms: 9, at: 5678, error: "NOT_CONFIGURED", skipped: true });
    expect(by("gravatar").lastSeen).toEqual({ ok: false, ms: 7, at: 999, error: "HTTP 503" });
  });

  it("reports the live runtime limits", async () => {
    process.env.RATE_LIMIT_MAX = "123";
    try {
      const json = await (await sourcesGET()).json();
      expect(json.runtime.rateLimit.max).toBe(123);
      expect(json.runtime.cache.phone.ttlMs).toBe(86_400_000);
      expect(json.runtime.cache.entries).toHaveProperty("phone");
    } finally {
      delete process.env.RATE_LIMIT_MAX;
    }
  });

  it("never returns a key value", async () => {
    await setKey("IPQS_API_KEY", "super-secret-value");
    const body = JSON.stringify(await (await sourcesGET()).json());
    expect(body).not.toContain("super-secret-value");
  });
});
