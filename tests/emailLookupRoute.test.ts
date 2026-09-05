import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/email-lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie } from "./testUtils";

// End-to-end handler test for the email lookup. Gravatar and XposedOrNot are
// keyless and hit on every request, so both are stubbed in every case. EmailRep
// needs a key (its keyless tier is a permanent 429), so it stays NOT_CONFIGURED
// unless EMAILREP_API_KEY is set — just like the other keyed sources.
// TRUST_PROXY=1 + a unique client IP isolates the rate-limit bucket; HV_DATA_DIR
// points the audit + key store at a temp dir.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-emailroute-"));
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
  delete process.env.RAPIDAPI_KEY;
  delete process.env.EMAILREP_API_KEY;
});

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

// The three keyless upstreams, in their "nothing found" form.
const gravatar404 = resp(404, {}, false);
const emailrepBenign = resp(200, {
  email: "x", reputation: "none", suspicious: false, references: 0,
  details: { deliverable: true, valid_mx: true, free_provider: true },
});
const xonEmpty = resp(404, {}, false);
// Keyless MX over Cloudflare DoH — the shared `dns` source, now also read by
// email mode to fingerprint the mail provider.
const mxGoogle = resp(200, { Answer: [
  { name: "gmail.com", type: 15, TTL: 300, data: "5 gmail-smtp-in.l.google.com." },
] });

function stubFetch(map: Array<[string, Response]>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [needle, r] of map) if (u.includes(needle)) return r;
    throw new TypeError("unexpected fetch: " + u);
  }));
}

let ipCounter = 0;
const post = (payload: unknown) => {
  const clientIp = `203.0.115.${++ipCounter}`;
  const req = new Request("http://localhost/api/email-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/email-lookup: input validation", () => {
  it("400 on a body with no email field", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request body");
  });

  it("400 (Missing email address) on a whitespace-only value", async () => {
    const res = await post({ email: "   " }); // passes zod min(3), trims to empty
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing email address");
  });

  it("400 on a value that isn't a valid email format", async () => {
    const res = await post({ email: "notanemail" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid email address format");
  });
});

describe("POST /api/email-lookup: offline happy path (no paid keys)", () => {
  it("classifies the address, merges Gravatar, and marks keyed sources NOT_CONFIGURED", async () => {
    stubFetch([
      ["gravatar.com", resp(200, {
        entry: [{
          displayName: "Test User", preferredUsername: "testuser",
          currentLocation: "Berlin",
          accounts: [{ shortname: "github", username: "testuser", url: "https://github.com/testuser" }],
        }],
      })],
      ["cloudflare-dns.com", mxGoogle],
      ["api.xposedornot.com", xonEmpty],
    ]);

    const res = await post({ email: "Test.User@gmail.com" });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Keyless MX fingerprint (the shared dns source) resolves the mail provider.
    expect(json.mail.ok).toBe(true);
    expect(json.mail.data.hasMx).toBe(true);
    expect(json.mail.data.provider).toBe("Google Workspace");
    expect(json.sourceHealth.some((h: { source: string }) => h.source === "dns")).toBe(true);

    // Offline analysis (normalized lowercase, provider classification)
    expect(json.email).toBe("test.user@gmail.com");
    expect(json.analysis.providerName).toBe("Gmail");
    expect(json.analysis.isWebmail).toBe(true);
    expect(json.analysis.isDisposable).toBe(false);

    // Gravatar mapped
    expect(json.gravatar.found).toBe(true);
    expect(json.gravatar.displayName).toBe("Test User");
    expect(json.gravatar.accounts[0].shortname).toBe("github");

    // XposedOrNot empty; keyed sources (incl. EmailRep — keyless tier is a
    // permanent 429) reported NOT_CONFIGURED without a doomed request.
    expect(json.xon.ok).toBe(true);
    expect(json.xon.data.breachCount).toBe(0);
    expect(json.emailrep.error).toBe("NOT_CONFIGURED");
    expect(json.hunter.error).toBe("NOT_CONFIGURED");
    expect(json.breachDirectory.error).toBe("NOT_CONFIGURED");
  });

  it("hits EmailRep and maps its reputation payload when EMAILREP_API_KEY is set", async () => {
    process.env.EMAILREP_API_KEY = "test-emailrep";
    stubFetch([
      ["gravatar.com", gravatar404],
      ["cloudflare-dns.com", mxGoogle],
      ["emailrep.io", emailrepBenign],
      ["api.xposedornot.com", xonEmpty],
    ]);

    const res = await post({ email: "keyed@gmail.com" });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.emailrep.ok).toBe(true);
    expect(json.emailrep.data.reputation).toBe("none");
    expect(json.emailrep.data.deliverable).toBe(true);
  });
});

describe("POST /api/email-lookup: breach parsing", () => {
  it("parses XposedOrNot breach details and configured BreachDirectory hits", async () => {
    process.env.RAPIDAPI_KEY = "test-rapid";
    stubFetch([
      ["gravatar.com", gravatar404],
      ["cloudflare-dns.com", mxGoogle],
      ["emailrep.io", emailrepBenign],
      ["api.xposedornot.com", resp(200, {
        BreachMetrics: { count: 1, yearwise_details: [{ "2019": 1 }] },
        ExposedBreaches: {
          breaches_details: [{
            breach: "Collection1", xposed_data: "Passwords;Email addresses",
            xposed_date: "2019", xposed_records: 1000, domain: "example.com",
            password_risk: "plaintext", verified: 1,
          }],
        },
      })],
      ["breachdirectory.p.rapidapi.com", resp(200, {
        found: 2, fields: ["password"], sources: ["Collection1"],
        result: [{ password: "pw", sha1: "aa", sources: ["Collection1"] }],
      })],
    ]);

    const res = await post({ email: "victim@example.com" });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.xon.ok).toBe(true);
    expect(json.xon.data.breachCount).toBe(1);
    expect(json.xon.data.breaches[0].breach).toBe("Collection1");
    expect(json.xon.data.breaches[0].verified).toBe(true);
    expect(json.xon.data.breaches[0].xposedData).toContain("Passwords");

    expect(json.breachDirectory.ok).toBe(true);
    expect(json.breachDirectory.data.found).toBe(2);
  });
});

describe("POST /api/email-lookup: rate limiting", () => {
  afterEach(restoreRateLimit);

  it("allows MAX requests then 429s the next from the same client", async () => {
    useRateLimit(10);
    stubFetch([
      ["gravatar.com", gravatar404],
      ["cloudflare-dns.com", mxGoogle],
      ["emailrep.io", emailrepBenign],
      ["api.xposedornot.com", xonEmpty],
    ]);
    const req = () => new Request("http://localhost/api/email-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("rlclient") },
      body: JSON.stringify({ email: "rl@example.com" }),
    });
    let last = await POST(req() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(req() as unknown as NextRequest);
    expect(last.status).toBe(200);
    const over = await POST(req() as unknown as NextRequest);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("60");
  });
});
