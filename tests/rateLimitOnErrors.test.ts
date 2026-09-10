import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { ENDPOINTS } from "@/lib/api/endpoints";
import { POST as phone } from "@/app/api/lookup/route";
import { POST as email } from "@/app/api/email-lookup/route";
import { POST as username } from "@/app/api/username-lookup/route";
import { POST as ip } from "@/app/api/ip-lookup/route";
import { POST as domain } from "@/app/api/domain-lookup/route";
import { POST as wallet } from "@/app/api/wallet-lookup/route";
import { POST as hash } from "@/app/api/hash-lookup/route";
import { POST as pwned } from "@/app/api/pwned-password/route";
import { POST as bulk } from "@/app/api/bulk-lookup/route";
import { POST as aiAnalyst } from "@/app/api/ai-analyst/route";

// Every rate-limited route charges the quota BEFORE it validates the body, so a
// 400 has already spent a request. Eight of them answered that 400 without
// X-RateLimit-*, leaving a client unable to see the budget it had just used.
// This drives each route with bad input, and holds the endpoint registry to the
// list: a new rate-limited route missing from ROUTES fails the first test.

type Handler = (req: NextRequest) => Promise<Response>;

// A string payload is sent raw, which is how a malformed-JSON body is exercised.
const ROUTES: Record<string, { handler: Handler; bad: unknown[] }> = {
  "/api/lookup":          { handler: phone,     bad: ["{oops", {}, { number: "   " }, { number: "abc" }] },
  "/api/email-lookup":    { handler: email,     bad: ["{oops", {}, { email: "   " }, { email: "not-an-email" }] },
  "/api/username-lookup": { handler: username,  bad: ["{oops", {}, { username: "   " }, { username: "a b!" }] },
  "/api/ip-lookup":       { handler: ip,        bad: ["{oops", {}, { ip: "   " }, { ip: "999.1.1.1" }] },
  "/api/domain-lookup":   { handler: domain,    bad: ["{oops", {}, { domain: "https://" }, { domain: "not a domain!!" }] },
  "/api/wallet-lookup":   { handler: wallet,    bad: ["{oops", {}, { address: "nope" }] },
  "/api/hash-lookup":     { handler: hash,      bad: ["{oops", {}, { hash: "xyz" }] },
  "/api/pwned-password":  { handler: pwned,     bad: ["{oops", {}, { prefix: "zz" }] },
  "/api/bulk-lookup":     { handler: bulk,      bad: ["{oops", {}, { numbers: [] }] },
  "/api/ai-analyst":      { handler: aiAnalyst, bad: ["{oops", {}, { provider: "nope", model: "m", system: "s", user: "u" }] },
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-rl-errors-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
  // A 400 must be decided before any upstream is called.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no upstream call expected on a 400"); }));
});
afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => expect(fetch).not.toHaveBeenCalled());

let client = 0;
const send = (handler: Handler, path: string, payload: unknown) =>
  handler(new Request(`http://localhost${path}`, {
    method: "POST",
    // A fresh client per request, so Remaining is exactly one below Limit.
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++client}` },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }) as unknown as NextRequest);

describe("rate-limit headers on error responses", () => {
  it("covers every rate-limited route in the endpoint registry", () => {
    const limited = ENDPOINTS.filter((e) => e.rateLimited).map((e) => e.path).sort();
    expect(Object.keys(ROUTES).sort()).toEqual(limited);
  });

  for (const [path, { handler, bad }] of Object.entries(ROUTES)) {
    it(`${path} reports the quota it charged on every 400`, async () => {
      for (const payload of bad) {
        const res = await send(handler, path, payload);
        const what = `${path} ${JSON.stringify(payload)}`;
        expect(res.status, what).toBe(400);
        const limit = Number(res.headers.get("X-RateLimit-Limit"));
        expect(limit, what).toBeGreaterThan(0);
        expect(Number(res.headers.get("X-RateLimit-Remaining")), what).toBe(limit - 1);
        expect(res.headers.get("X-RateLimit-Window"), what).toMatch(/^\d+s$/);
        expect(res.headers.get("X-RateLimit-Scope"), what).toBe("client");
      }
    });
  }
});
