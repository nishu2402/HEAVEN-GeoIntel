import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  CLIENT_ID_COOKIE,
  checkRateLimit,
  getClientKey,
  guardRateLimit,
  purgeExpired,
  rateLimitHeaders,
  rateLimitedResponse,
  resetRateLimit,
} from "@/lib/server/rateLimit";

// Fixed-window limiter with a per-client bucket AND a server-wide ceiling, plus
// client-key derivation. The key logic must NOT trust spoofable proxy headers
// unless the operator opts in.

// Duck-typed NextRequest — the limiter only reads headers.get().
const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as import("next/server").NextRequest;

const ENV_KEYS = ["TRUST_PROXY", "RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_GLOBAL_MAX"];

beforeEach(() => {
  resetRateLimit();
  // Keep the default (60/min) out of these cases — a small explicit limit keeps
  // them fast and makes the boundary obvious.
  process.env.RATE_LIMIT_MAX = "10";
});

afterEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  resetRateLimit();
});

describe("checkRateLimit (fixed window, per client)", () => {
  it("allows the first MAX requests then denies, with correct remaining", () => {
    const key = "client-a";
    const remainings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit(key);
      expect(r.allowed, `req ${i + 1}`).toBe(true);
      remainings.push(r.remaining);
    }
    expect(remainings).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

    const over = checkRateLimit(key);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.scope).toBe("client");
    expect(over.retryAfter).toBeGreaterThan(0);
  });

  it("tracks separate clients independently: the defect this replaced", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("client-a");
    expect(checkRateLimit("client-a").allowed).toBe(false); // a exhausted
    expect(checkRateLimit("client-b").allowed).toBe(true); // b untouched
  });

  it("honours RATE_LIMIT_MAX from the environment", () => {
    process.env.RATE_LIMIT_MAX = "2";
    expect(checkRateLimit("k").remaining).toBe(1);
    expect(checkRateLimit("k").remaining).toBe(0);
    expect(checkRateLimit("k").allowed).toBe(false);
  });

  it("starts a new window once the old one has elapsed", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) checkRateLimit("k", t0);
    expect(checkRateLimit("k", t0).allowed).toBe(false);
    expect(checkRateLimit("k", t0 + 61_000).allowed).toBe(true);
  });
});

describe("global ceiling", () => {
  it("denies with scope=global once the server-wide budget is spent", () => {
    process.env.RATE_LIMIT_GLOBAL_MAX = "3";
    expect(checkRateLimit("a").allowed).toBe(true);
    expect(checkRateLimit("b").allowed).toBe(true);
    expect(checkRateLimit("c").allowed).toBe(true);

    const denied = checkRateLimit("d");
    expect(denied.allowed).toBe(false);
    expect(denied.scope).toBe("global");
    expect(denied.limit).toBe(3);
  });

  it("does not charge a client for a request the global ceiling rejected", () => {
    process.env.RATE_LIMIT_GLOBAL_MAX = "1";
    checkRateLimit("other"); // spends the whole global budget
    const denied = checkRateLimit("victim");
    expect(denied.allowed).toBe(false);

    // Raise the ceiling: the victim must still have its full allowance, since
    // its earlier attempt never actually ran.
    process.env.RATE_LIMIT_GLOBAL_MAX = "100";
    expect(checkRateLimit("victim").remaining).toBe(9);
  });
});

describe("purgeExpired (background cleanup)", () => {
  it("drops buckets older than 2× the window, keeps recent ones", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("stale"); // exhaust → bucket exists
    checkRateLimit("fresh");

    // Far-future "now" makes the stale bucket older than 2×window, so it's purged.
    purgeExpired(Date.now() + 5 * 60_000);
    expect(checkRateLimit("stale").allowed).toBe(true);
    expect(checkRateLimit("stale").remaining).toBe(8);
  });

  it("leaves buckets alone when nothing has expired", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("recent"); // exhausted now
    purgeExpired(Date.now()); // no time has passed → nothing purged
    expect(checkRateLimit("recent").allowed).toBe(false); // still limited
  });
});

describe("getClientKey", () => {
  it("ignores spoofable proxy headers unless TRUST_PROXY=1", () => {
    const req = reqWith({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" });
    expect(getClientKey(req)).toBe("shared");
  });

  it("uses the first X-Forwarded-For hop when TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientKey(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("ip:1.2.3.4");
  });

  it("falls back to X-Real-IP, then the shared bucket, when trusting the proxy", () => {
    process.env.TRUST_PROXY = "1";
    expect(getClientKey(reqWith({ "x-real-ip": "9.9.9.9" }))).toBe("ip:9.9.9.9");
    expect(getClientKey(reqWith({}))).toBe("shared");
  });

  it("gives each browser its own bucket via the rate-limit cookie", () => {
    const a = reqWith({ cookie: `${CLIENT_ID_COOKIE}=aaaaaaaaaaaaaaaa` });
    const b = reqWith({ cookie: `other=1; ${CLIENT_ID_COOKIE}=bbbbbbbbbbbbbbbb; x=2` });
    expect(getClientKey(a)).toBe("cid:aaaaaaaaaaaaaaaa");
    expect(getClientKey(b)).toBe("cid:bbbbbbbbbbbbbbbb");
  });

  it("rejects a cookie value that could grow the bucket map without bound", () => {
    expect(getClientKey(reqWith({ cookie: `${CLIENT_ID_COOKIE}=short` }))).toBe("shared");
    expect(getClientKey(reqWith({ cookie: `${CLIENT_ID_COOKIE}=${"x".repeat(200)}` }))).toBe("shared");
    expect(getClientKey(reqWith({ cookie: `${CLIENT_ID_COOKIE}=has spaces here` }))).toBe("shared");
  });

  it("ignores a malformed cookie header", () => {
    expect(getClientKey(reqWith({ cookie: "novalue; =nokey" }))).toBe("shared");
  });

  it("prefers a trusted proxy IP over the cookie", () => {
    process.env.TRUST_PROXY = "1";
    const req = reqWith({ "x-forwarded-for": "1.2.3.4", cookie: `${CLIENT_ID_COOKIE}=aaaaaaaaaaaaaaaa` });
    expect(getClientKey(req)).toBe("ip:1.2.3.4");
  });
});

describe("response shaping", () => {
  it("emits the same headers on every route", () => {
    const headers = rateLimitHeaders(checkRateLimit("k"));
    expect(headers).toEqual({
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "9",
      "X-RateLimit-Window": "60s",
      "X-RateLimit-Scope": "client",
    });
  });

  it("returns a 429 carrying Retry-After and the limit headers", async () => {
    for (let i = 0; i < 10; i++) checkRateLimit("k");
    const res = rateLimitedResponse(checkRateLimit("k"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Scope")).toBe("client");
    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toContain("Rate limit exceeded");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("explains a global rejection differently from a per-client one", async () => {
    process.env.RATE_LIMIT_GLOBAL_MAX = "1";
    checkRateLimit("other");
    const res = rateLimitedResponse(checkRateLimit("k"));
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Server-wide");
    expect(res.headers.get("X-RateLimit-Scope")).toBe("global");
  });
});

describe("guardRateLimit", () => {
  it("passes through with headers and the client key while under the limit", () => {
    const out = guardRateLimit(reqWith({ cookie: `${CLIENT_ID_COOKIE}=aaaaaaaaaaaaaaaa` }));
    expect(out.limited).toBeNull();
    expect(out.client).toBe("cid:aaaaaaaaaaaaaaaa");
    expect(out.headers!["X-RateLimit-Remaining"]).toBe("9");
  });

  it("returns a ready-made 429 once the client is over", () => {
    const req = reqWith({});
    for (let i = 0; i < 10; i++) guardRateLimit(req);
    const out = guardRateLimit(req);
    expect(out.limited?.status).toBe(429);
    expect(out.client).toBe("shared");
  });
});
