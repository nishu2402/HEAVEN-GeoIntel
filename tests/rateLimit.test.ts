import { describe, it, expect, afterEach } from "vitest";
import { checkRateLimit, getClientIp, purgeExpired } from "@/lib/server/rateLimit";

// Fixed-window limiter (10 req / 60s / IP) + client-IP extraction. The IP logic
// must NOT trust spoofable proxy headers unless the operator opts in.

// Duck-typed NextRequest — getClientIp only reads headers.get().
const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as import("next/server").NextRequest;

describe("checkRateLimit (fixed window)", () => {
  it("allows the first MAX requests then denies, with correct remaining", () => {
    const ip = "test-ip-" + Math.random(); // fresh bucket, avoids cross-test state
    const remainings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(ip);
      expect(r.allowed, `req ${i + 1}`).toBe(true);
      remainings.push(r.remaining);
    }
    expect(remainings).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

    const over = checkRateLimit(ip);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("tracks separate IPs independently", () => {
    const a = "ip-a-" + Math.random();
    const b = "ip-b-" + Math.random();
    for (let i = 0; i < 10; i++) checkRateLimit(a);
    expect(checkRateLimit(a).allowed).toBe(false); // a exhausted
    expect(checkRateLimit(b).allowed).toBe(true);  // b untouched
  });
});

describe("purgeExpired (background cleanup)", () => {
  it("drops buckets older than 2× the window, keeps recent ones", () => {
    const stale = "stale-" + Math.random();
    const fresh = "fresh-" + Math.random();
    for (let i = 0; i < 10; i++) checkRateLimit(stale); // exhaust → bucket exists
    checkRateLimit(fresh);

    // Far-future "now" makes the stale bucket older than 2×window, so it's purged.
    purgeExpired(Date.now() + 5 * 60_000);
    // Purged → a brand-new window (allowed again, remaining 9).
    expect(checkRateLimit(stale)).toEqual({ allowed: true, remaining: 9 });
  });

  it("leaves buckets alone when nothing has expired", () => {
    const ip = "recent-" + Math.random();
    for (let i = 0; i < 10; i++) checkRateLimit(ip); // exhausted now
    purgeExpired(Date.now()); // no time has passed → nothing purged
    expect(checkRateLimit(ip).allowed).toBe(false); // still limited
  });
});

describe("getClientIp", () => {
  afterEach(() => { delete process.env.TRUST_PROXY; });

  it("ignores spoofable headers unless TRUST_PROXY=1", () => {
    const req = reqWith({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" });
    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  it("uses the first X-Forwarded-For hop when TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to X-Real-IP, then localhost, when trusting the proxy", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientIp(reqWith({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(getClientIp(reqWith({}))).toBe("127.0.0.1");
  });
});
