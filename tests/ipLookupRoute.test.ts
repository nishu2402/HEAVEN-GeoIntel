import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/ip-lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie } from "./testUtils";

// End-to-end handler test: drives the real POST through the shared middleware
// (rate-limit → parseBody → IP validation → fetchSafe upstreams → threat/merge
// → provenance) with every upstream mocked. TRUST_PROXY=1 + a unique client IP
// per request isolates the module-level rate-limit bucket; HV_DATA_DIR points
// the fire-and-forget audit write at a temp dir.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-iproute-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => vi.unstubAllGlobals());

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

// Route mocked fetch by URL host so each upstream gets its own canned payload.
function stubFetch(map: Array<[string, Response]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [needle, r] of map) if (u.includes(needle)) return r;
    throw new TypeError("unexpected fetch: " + u);
  }));
}

let ipCounter = 0;
const post = (payload: unknown) => {
  const clientIp = `203.0.113.${++ipCounter}`; // unique per call → own RL bucket
  const req = new Request("http://localhost/api/ip-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/ip-lookup — input validation", () => {
  it("400 on a malformed body", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("400 on a non-IP target", async () => {
    const res = await post({ ip: "not-an-ip" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Not a valid IPv4 / IPv6 address");
  });
});

describe("POST /api/ip-lookup — happy path with merged sources", () => {
  it("returns geo + Shodan exposure + GreyNoise, computes threat, and attaches provenance", async () => {
    stubFetch([
      ["ip-api.com", resp(200, {
        status: "success", country: "United States", countryCode: "US",
        regionName: "California", city: "Mountain View", lat: 37.4, lon: -122.1,
        isp: "Google LLC", org: "Google Public DNS", as: "AS15169 Google LLC",
        reverse: "dns.google", proxy: false, hosting: true, query: "8.8.8.8",
      })],
      ["internetdb.shodan.io", resp(200, { ports: [443, 853], vulns: ["CVE-2021-1234"], hostnames: ["dns.google"], tags: ["cloud"] })],
      ["api.greynoise.io", resp(200, { classification: "benign", noise: true, riot: true, name: "Google Public DNS" })],
    ]);

    const res = await post({ ip: "8.8.8.8" });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.ip.country).toBe("United States");
    expect(json.ip.type).toBe("IPv4");
    expect(json.ip.asn).toBe(15169);
    expect(json.ip.asnOrg).toBe("Google LLC");
    expect(json.ip.ports).toEqual([443, 853]);
    expect(json.ip.vulns).toEqual(["CVE-2021-1234"]);
    expect(json.ip.greyNoise.classification).toBe("benign");

    // hosting(35) capped under the known-CVE signal (60 + 5) => 65 / MODERATE
    expect(json.threatScore).toBe(65);
    expect(json.threatLabel).toBe("MODERATE");

    // provenance: all three sources present and marked ok
    expect(json.sources).toHaveLength(3);
    expect(json.sources.every((s: { ok: boolean }) => s.ok)).toBe(true);
    expect(json.pivots.length).toBeGreaterThan(0);
  });
});

describe("POST /api/ip-lookup — degraded upstreams", () => {
  it("falls back gracefully (ip:null + error) when the geo source is unreachable", async () => {
    stubFetch([
      ["ip-api.com", resp(0, null, false)], // network-ish failure
      ["internetdb.shodan.io", resp(404, {})],
      ["api.greynoise.io", resp(404, {})],
    ]);
    const res = await post({ ip: "8.8.8.8" });
    const json = await res.json();
    expect(json.ip).toBeNull();
    expect(json.error).toBeTruthy();
    expect(json.pivots.length).toBeGreaterThan(0); // pivots still offered
  });
});

describe("POST /api/ip-lookup — offline scope classification", () => {
  it("short-circuits a private (RFC 1918) address with NO upstream calls", async () => {
    // fetch is left un-stubbed: any upstream call would throw. A non-routable
    // address must be answered entirely offline.
    const fetchSpy = vi.fn(async () => { throw new Error("should not fetch"); });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await post({ ip: "10.0.0.1" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ip).toBeNull();
    expect(json.classification.scope).toBe("private");
    expect(json.classification.rfc).toBe("RFC 1918");
    expect(json.classification.isGloballyRoutable).toBe(false);
    expect(json.threatLabel).toBe("NOT ROUTABLE");
    expect(json.sources).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled(); // zero wasted upstream calls
    expect(json.pivots.length).toBeGreaterThan(0);
  });

  it("classifies loopback and CGNAT offline too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no fetch"); }));
    expect((await (await post({ ip: "127.0.0.1" })).json()).classification.scope).toBe("loopback");
    expect((await (await post({ ip: "100.64.0.1" })).json()).classification.scope).toBe("cgnat");
  });

  it("attaches a global classification to a routable public IP and still geolocates", async () => {
    stubFetch([
      ["ip-api.com", resp(200, { status: "success", country: "United States", countryCode: "US", query: "8.8.8.8", as: "AS15169 Google LLC" })],
      ["internetdb.shodan.io", resp(404, {})],
      ["api.greynoise.io", resp(404, {})],
    ]);
    const json = await (await post({ ip: "8.8.8.8" })).json();
    expect(json.ip).not.toBeNull();
    expect(json.classification.scope).toBe("global");
    expect(json.classification.isGloballyRoutable).toBe(true);
  });
});

describe("POST /api/ip-lookup — rate limiting", () => {
  afterEach(restoreRateLimit);

  it("allows MAX requests then 429s the next from the same client", async () => {
    useRateLimit(10);
    stubFetch([
      ["ip-api.com", resp(200, { status: "success", query: "1.1.1.1", countryCode: "US" })],
      ["internetdb.shodan.io", resp(404, {})],
      ["api.greynoise.io", resp(404, {})],
    ]);
    const req = () => new Request("http://localhost/api/ip-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("rlclient") },
      body: JSON.stringify({ ip: "1.1.1.1" }),
    });
    let last = await POST(req() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(req() as unknown as NextRequest);
    expect(last.status).toBe(200); // 10th still allowed
    const over = await POST(req() as unknown as NextRequest);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("60");
  });
});
