import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie } from "./testUtils";

// End-to-end handler test for the phone lookup: drives the real POST through the
// shared middleware (rate-limit → parseBody → libphonenumber parse → offline
// analysis → parallel enrichment fan-out → threat/merge). Every upstream is
// mocked; Hudson Rock is always called (no key) so it's stubbed in every case.
// TRUST_PROXY=1 + a unique client IP per request isolates the module-level
// rate-limit bucket; HV_DATA_DIR points the fire-and-forget audit + key store at
// a temp dir so no provider key leaks in from the host env.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-lookuproute-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  // Never let a configured key bleed between tests.
  delete process.env.IPQS_API_KEY;
  delete process.env.RAPIDAPI_KEY;
});

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

// Hudson Rock "no infection" — the free, keyless upstream hit on every lookup.
const hudsonClean = resp(200, {
  message: "This phone is not associated with a computer infected by an info-stealer.",
  stealers: [],
});

function stubFetch(map: Array<[string, Response]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [needle, r] of map) if (u.includes(needle)) return r;
    throw new TypeError("unexpected fetch: " + u);
  }));
}

let ipCounter = 0;
const post = (payload: unknown) => {
  const clientIp = `203.0.114.${++ipCounter}`; // unique per call → own RL bucket
  const req = new Request("http://localhost/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/lookup — input validation", () => {
  it("400 on a body with no number field", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("400 (Missing phone number) on a whitespace-only number", async () => {
    // Passes zod min(1) but trims to empty — the route's own guard fires.
    const res = await post({ number: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing phone number");
  });

  it("400 on an unparseable number", async () => {
    const res = await post({ number: "not-a-real-number" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid or unparseable phone number");
  });
});

describe("POST /api/lookup — offline happy path (no provider keys)", () => {
  it("returns full offline analysis with all paid sources NOT_CONFIGURED and CLEAN threat", async () => {
    stubFetch([["cavalier.hudsonrock.com", hudsonClean]]);

    const res = await post({ number: "+14155552671" });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Core parse + offline analysis
    expect(json.input.e164).toBe("+14155552671");
    expect(json.input.country).toBe("US");
    expect(json.analysis.areaCode).toBe("415");
    // NPA-specific timezone (Pacific), not the US country default (Eastern)
    expect(json.analysis.timezones).toEqual(["America/Los_Angeles"]);
    expect(json.offline.confidence).toBe("high");

    // Paid sources absent → NOT_CONFIGURED; Hudson Rock ran and found nothing
    expect(json.sources.numverify).toEqual({ ok: false, error: "NOT_CONFIGURED" });
    expect(json.sources.ipqs.error).toBe("NOT_CONFIGURED");
    expect(json.sources.hudsonRock.ok).toBe(true);
    expect(json.sources.hudsonRock.data.total).toBe(0);

    // Nothing risky → CLEAN
    expect(json.threatScore).toBe(0);
    expect(json.threatLabel).toBe("CLEAN");

    expect(res.headers.get("X-RateLimit-Limit")).toBe("60"); // shipped default
    expect(res.headers.get("X-RateLimit-Scope")).toBe("client");
  });
});

describe("POST /api/lookup — enrichment merge + threat scoring", () => {
  it("merges IPQS/breach/Hudson Rock into a CRITICAL score with a resolved carrier", async () => {
    process.env.IPQS_API_KEY = "test-ipqs";
    process.env.RAPIDAPI_KEY = "test-rapid";

    stubFetch([
      ["ipqualityscore.com", resp(200, {
        success: true, carrier: "Verizon Wireless", line_type: "Wireless",
        region: "California", fraud_score: 95, VOIP: true, risky: true,
        recent_abuse: true, prepaid: true, active: false, name: "J. Doe",
        city: "Oakland",
      })],
      ["breachdirectory.p.rapidapi.com", resp(200, {
        found: 3, fields: ["password"], sources: ["Collection#1"],
        result: [{ password: "hunter2", sha1: "abc", sources: ["Collection#1"] }],
      })],
      ["cavalier.hudsonrock.com", resp(200, {
        stealers: [
          { computer_name: "DESKTOP-X", operating_system: "Windows 10",
            malware_path: "C:\\Users\\x\\redline.exe", date_compromised: "2023-01-02",
            ip: "10.0.0.1", top_passwords: ["hunter2"], top_logins: ["j@x.com"] },
          { computer_name: "LAPTOP-Y", operating_system: "Windows 11",
            malware_path: "C:\\vidar.exe", top_passwords: [], top_logins: [] },
        ],
      })],
    ]);

    const res = await post({ number: "+12125550123" });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Best-pick merge pulled the IPQS carrier + region into aggregated
    expect(json.aggregated.carrier).toBe("Verizon Wireless");
    expect(json.aggregated.region).toBe("California");
    expect(json.aggregated.fraudScore).toBe(95);
    expect(json.aggregated.isVoip).toBe(true);
    expect(json.aggregated.callerName).toBe("J. Doe");

    // Breach + infostealer hits present
    expect(json.sources.breachDirectory.data.found).toBe(3);
    expect(json.sources.hudsonRock.data.total).toBe(2);
    expect(json.sources.hudsonRock.data.stealers[0].malwareFamily).toBe("Redline");

    // fraud 95→57, +risky/abuse, +breach, +2 infections ⇒ well over 70
    expect(json.threatScore).toBeGreaterThanOrEqual(70);
    expect(json.threatLabel).toBe("CRITICAL");
  });
});

describe("POST /api/lookup — caching", () => {
  it("serves the second identical lookup from cache without re-calling upstreams", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("cavalier.hudsonrock.com")) return hudsonClean;
      throw new TypeError("unexpected fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await post({ number: "+13105550188" });
    expect(first.status).toBe(200);
    const callsAfterFirst = fetchMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // Hudson Rock was hit

    const second = await post({ number: "+13105550188" });
    expect(second.status).toBe(200);
    // Cache short-circuits before the enrichment fan-out — no new fetches.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect((await second.json()).input.e164).toBe("+13105550188");
  });
});

describe("POST /api/lookup — rate limiting", () => {
  afterEach(restoreRateLimit);

  const req = (cookie: string) => () => new Request("http://localhost/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ number: "+16465550170" }),
  });

  it("allows MAX requests then 429s the next from the same client", async () => {
    useRateLimit(10);
    stubFetch([["cavalier.hudsonrock.com", hudsonClean]]);
    const make = req(clientCookie("lookupclient1"));
    let last = await POST(make() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(make() as unknown as NextRequest);
    expect(last.status).toBe(200); // 10th still allowed
    const over = await POST(make() as unknown as NextRequest);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(over.headers.get("X-RateLimit-Scope")).toBe("client");
  });

  it("does not let one exhausted client throttle another — the P1 defect", async () => {
    useRateLimit(2);
    stubFetch([["cavalier.hudsonrock.com", hudsonClean]]);
    const a = req(clientCookie("browserAAA"));
    const b = req(clientCookie("browserBBB"));

    await POST(a() as unknown as NextRequest);
    await POST(a() as unknown as NextRequest);
    expect((await POST(a() as unknown as NextRequest)).status).toBe(429); // A is spent

    // B has never made a request; before the fix it would already be blocked.
    expect((await POST(b() as unknown as NextRequest)).status).toBe(200);
  });

  it("reports the server-wide ceiling separately from the per-client one", async () => {
    useRateLimit(100);
    process.env.RATE_LIMIT_GLOBAL_MAX = "1";
    stubFetch([["cavalier.hudsonrock.com", hudsonClean]]);
    await POST(req(clientCookie("firstclient"))() as unknown as NextRequest);
    const denied = await POST(req(clientCookie("secondclient"))() as unknown as NextRequest);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("X-RateLimit-Scope")).toBe("global");
  });
});
