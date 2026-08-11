import { describe, it, expect, afterEach, vi } from "vitest";
import {
  canSpend, retryAfter, record, spend, backOff, resetBudgets, fetchBudgeted,
} from "@/lib/server/upstreamBudget";
import { fetchJson } from "@/lib/server/fetchSafe";

// ── Not calling a provider that told us to stop ──────────────────────────────
//
// The bug this module fixes: ip-api.com's free tier is 45 requests per minute
// per source IP, and 2.0.1 ignored the `X-Rl` / `X-Ttl` headers it received on
// every single response. Cross the limit and every IP lookup failed; keep
// pressing the button — which is what people do — and ip-api bans the source IP
// for an hour. The quota was in our hands the whole time.
//
// These tests drive the clock explicitly rather than sleeping: the behaviour
// that matters is what happens across a window boundary.

afterEach(() => {
  resetBudgets();
  vi.unstubAllGlobals();
});

const resp = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  }) as unknown as Response;

describe("a provider we know nothing about", () => {
  it("is always callable — silence is not evidence of an exhausted quota", () => {
    expect(canSpend("never-seen")).toBe(true);
    expect(retryAfter("never-seen")).toBeNull();
  });

  it("stays callable when its headers are unparseable", () => {
    // A provider that changes its header format, or a proxy that strips it,
    // must not be able to corrupt the budget into blocking every call.
    record("weird", "not-a-number", "60");
    record("weird", "5", "later");
    record("weird", null, null);
    record("weird", "-1", "60");
    expect(canSpend("weird")).toBe(true);
  });
});

describe("a provider that publishes its quota", () => {
  it("is callable while it has budget and blocked once it runs out", () => {
    record("ip-api.com", "40", "60", 1000);
    expect(canSpend("ip-api.com", 1000)).toBe(true);

    record("ip-api.com", "1", "60", 1000);
    expect(canSpend("ip-api.com", 1000)).toBe(false);
    expect(retryAfter("ip-api.com", 1000)).toBe(60);
  });

  it("keeps a reserve rather than spending the provider's last request", () => {
    // Our tally and theirs drift — a retry, a second browser tab, another
    // process on the same IP. The last couple are left unspent instead of
    // gambled on the counts agreeing.
    record("p", "3", "60", 0);
    expect(canSpend("p", 0)).toBe(true);
    record("p", "2", "60", 0);
    expect(canSpend("p", 0)).toBe(false);
  });

  it("becomes callable again the moment the window turns over", () => {
    record("p", "0", "60", 1_000);
    expect(canSpend("p", 1_000)).toBe(false);
    expect(canSpend("p", 1_000 + 59_000)).toBe(false);
    expect(canSpend("p", 1_000 + 60_001)).toBe(true);
    // …and having expired, it is forgotten rather than kept as a stale entry.
    expect(retryAfter("p", 1_000 + 60_001)).toBeNull();
  });

  it("treats a zero-second window as one second, not as already expired", () => {
    record("p", "0", "0", 1_000);
    expect(canSpend("p", 1_000)).toBe(false);
    expect(retryAfter("p", 1_000)).toBe(1);
  });

  it("counts down as calls go out, so parallel calls cannot all pass one check", () => {
    record("p", "5", "60", 0);
    spend("p"); spend("p"); spend("p");
    expect(canSpend("p", 0)).toBe(false);
  });

  it("never counts below zero, and ignores spending on an unknown provider", () => {
    record("p", "1", "60", 0);
    spend("p"); spend("p"); spend("p");
    expect(canSpend("p", 0)).toBe(false);
    expect(() => spend("unknown")).not.toThrow();
  });

  it("backs off for a stated period even with no quota headers at all", () => {
    backOff("p", 30, 0);
    expect(canSpend("p", 0)).toBe(false);
    expect(retryAfter("p", 29_000)).toBe(1);
    expect(canSpend("p", 30_001)).toBe(true);
  });

  it("clamps a nonsensical back-off to a second rather than expiring instantly", () => {
    backOff("p", 0, 0);
    expect(canSpend("p", 0)).toBe(false);
  });

  it("reads an epoch timestamp as a deadline, not as a duration", () => {
    // The two conventions in the wild are indistinguishable by type: ip-api's
    // `X-Ttl` counts seconds down, GreyNoise's `x-ratelimit-reset` is epoch
    // seconds. Read the second as the first and a live source is parked for
    // decades — which is exactly what happened against the real API.
    const now = 1_786_409_405_000;             // ms
    record("gn", "0", 1_786_409_405 + 300, now); // "resets 5 minutes from now"
    expect(retryAfter("gn", now)).toBe(300);
  });

  it("never parks a source for longer than an hour, whatever it claims", () => {
    // The backstop for a header this heuristic reads wrong. Retrying early
    // costs one 429 that is already handled; retrying a week late means a
    // working provider silently stopped being used.
    const now = 1_786_409_405_000;
    record("gn", "0", 1_786_409_405 + 7 * 86_400, now); // a week out
    expect(retryAfter("gn", now)).toBe(3600);

    backOff("p", 86_400, 0);
    expect(retryAfter("p", 0)).toBe(3600);
  });

  it("treats an epoch that has already passed as the one-second floor", () => {
    const now = 1_786_409_405_000;
    record("p", "0", 1_786_000_000, now); // in the past
    expect(retryAfter("p", now)).toBe(1);
  });

  it("accepts numbers as readily as header strings", () => {
    // Headers arrive as strings, but nothing about the budget is header-shaped
    // — a caller with a parsed number should not have to stringify it first.
    record("p", 1, 60, 0);
    expect(canSpend("p", 0)).toBe(false);
    record("p", 40, 60, 0);
    expect(canSpend("p", 0)).toBe(true);
  });

  it("forgets everything on reset", () => {
    record("p", "0", "600", 0);
    resetBudgets();
    expect(canSpend("p", 0)).toBe(true);
  });
});

describe("fetchBudgeted", () => {
  it("passes the response through and learns the quota from its headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { ok: 1 }, { "x-rl": "1", "x-ttl": "45" })));
    const res = await fetchBudgeted<{ ok: number }>("https://x.test", { source: "p" });
    expect(res.data).toEqual({ ok: 1 });
    // One request left (below the reserve) → the next call must not go out.
    expect(canSpend("p")).toBe(false);
  });

  it("does not send a request it already knows will be refused", async () => {
    const f = vi.fn(async () => resp(200, {}, {}));
    vi.stubGlobal("fetch", f);
    backOff("p", 60);

    const res = await fetchBudgeted("https://x.test", { source: "p" });
    expect(f).not.toHaveBeenCalled();
    // The caller sees an ordinary failure and needs no special case for it.
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.error).toMatch(/rate-limited by source — retrying in \d+s/);
    expect(res.ms).toBe(0);
  });

  it("backs off when a 429 arrives, using Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(429, {}, { "retry-after": "120" })));
    await fetchBudgeted("https://x.test", { source: "p", allowNon2xx: true });
    expect(retryAfter("p")).toBeGreaterThan(100);
  });

  it("backs off on a 429 that names no duration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(429, {}, {})));
    await fetchBudgeted("https://x.test", { source: "p", allowNon2xx: true });
    expect(canSpend("p")).toBe(false);
  });

  it("reads the x-ratelimit-* spelling as well as ip-api's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      resp(200, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "30" })));
    await fetchBudgeted("https://x.test", { source: "p" });
    expect(canSpend("p")).toBe(false);
  });

  it("still captures a header the caller asked for itself", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {}, { "x-custom": "yes" })));
    const res = await fetchBudgeted("https://x.test", { source: "p", readHeaders: ["x-custom"] });
    expect(res.headers?.["x-custom"]).toBe("yes");
  });
});

describe("fetchJson header capture", () => {
  it("returns the named headers, lower-cased, and omits absent ones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {}, { "x-rl": "7" })));
    const res = await fetchJson("https://x.test", { source: "p", readHeaders: ["X-Rl", "X-Missing"] });
    expect(res.headers).toEqual({ "x-rl": "7" });
  });

  it("captures them on a non-2xx too — a 429 is when they matter most", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(503, {}, { "retry-after": "5" })));
    const res = await fetchJson("https://x.test", { source: "p", readHeaders: ["retry-after"] });
    expect(res.ok).toBe(false);
    expect(res.headers).toEqual({ "retry-after": "5" });
  });

  it("delivers the body when the response object carries no headers at all", async () => {
    // Duck-typed responses are normal here. The body is the point; the headers
    // are garnish, and failing the whole call over them reported a live source
    // as unreachable.
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({ ok: true, status: 200, json: async () => ({ v: 1 }) }) as unknown as Response));
    const res = await fetchJson<{ v: number }>("https://x.test", { source: "p", readHeaders: ["x-rl"] });
    expect(res.data).toEqual({ v: 1 });
    expect(res.headers).toBeUndefined();
  });

  it("explains a non-2xx by its status rather than by the parse that failed", async () => {
    // ip-api answers its own 429 with plain text. "invalid JSON from source"
    // sent the reader hunting for a parser bug instead of a rate limit.
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({
        ok: false, status: 429,
        json: async () => { throw new SyntaxError("Unexpected token o"); },
        headers: { get: () => null },
      }) as unknown as Response));
    const res = await fetchJson("https://x.test", { source: "p", allowNon2xx: true });
    expect(res.error).toBe("rate-limited by source");
  });

  it("still says so when a 200 body is genuinely unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({
        ok: true, status: 200,
        json: async () => { throw new SyntaxError("nope"); },
        headers: { get: () => null },
      }) as unknown as Response));
    const res = await fetchJson("https://x.test", { source: "p" });
    expect(res.error).toBe("invalid JSON from source");
  });

  it("gives a reason for a non-2xx that the caller chose to parse anyway", async () => {
    // Before this, allowNon2xx returned ok:false with `error` undefined, and
    // the source strip rendered a dead source with an empty explanation.
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, { message: "no" })));
    const res = await fetchJson("https://x.test", { source: "p", allowNon2xx: true });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not found");
    expect(res.data).toEqual({ message: "no" });
  });
});
