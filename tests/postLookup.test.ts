import { describe, it, expect, afterEach, vi } from "vitest";
import { postLookup } from "@/lib/client/postLookup";

// ── "Check your connection" was the wrong thing to say ───────────────────────
//
// All five lookup runners called `res.json()` before checking `res.ok`, inside
// a try whose catch read:
//
//   "Couldn't reach the server. Check your connection and try again."
//
// So any error response without a JSON body — an HTML 500 page, a 502 from a
// reverse proxy, an empty body — threw at the parse and landed in that catch.
// The user was sent to check their router while the server was the thing that
// had failed. These tests pin the distinction, because it is the one the reader
// acts on.

afterEach(() => vi.unstubAllGlobals());

const res = (status: number, body: string, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  }) as unknown as Response;

const stub = (r: Response | (() => never)) =>
  vi.stubGlobal("fetch", vi.fn(async () => (typeof r === "function" ? r() : r)));

describe("a successful lookup", () => {
  it("returns the parsed body", async () => {
    stub(res(200, JSON.stringify({ city: "Oslo" })));
    const out = await postLookup<{ city: string }>("/api/ip-lookup", { ip: "1.1.1.1" });
    expect(out).toEqual({ ok: true, data: { city: "Oslo" } });
  });

  it("sends JSON with the right method and content type", async () => {
    const f = vi.fn(async () => res(200, "{}"));
    vi.stubGlobal("fetch", f);
    await postLookup("/api/lookup", { number: "+15551234" });
    expect(f).toHaveBeenCalledWith("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"number":"+15551234"}',
    });
  });
});

describe("the failure the old code got wrong", () => {
  it("calls a 500 with an HTML body a server failure, not a connection problem", async () => {
    stub(res(500, "<!doctype html><title>Internal Server Error</title>"));
    const out = await postLookup("/api/lookup", {});
    expect(out).toEqual({ ok: false, error: "The server failed to complete the lookup (HTTP 500)." });
  });

  it("handles a 502 with an entirely empty body", async () => {
    stub(res(502, ""));
    const out = await postLookup("/api/lookup", {});
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toContain("502");
  });

  it("survives a body that cannot even be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      ({
        ok: false, status: 503,
        text: async () => { throw new TypeError("stream closed"); },
        headers: { get: () => null },
      }) as unknown as Response));
    const out = await postLookup("/api/lookup", {});
    expect((out as { error: string }).error).toContain("503");
  });
});

describe("errors the server explained itself", () => {
  it("prefers the route's own message: it says more than a status code", async () => {
    stub(res(400, JSON.stringify({ error: "Invalid or unparseable phone number" })));
    const out = await postLookup("/api/lookup", { number: "abc" });
    expect(out).toEqual({ ok: false, error: "Invalid or unparseable phone number" });
  });

  it("falls back to the status for a 4xx with no message", async () => {
    stub(res(403, "{}"));
    expect(await postLookup("/api/lookup", {})).toEqual({
      ok: false, error: "The request was rejected (HTTP 403).",
    });
  });
});

describe("rate limiting is rewritten for the person reading it", () => {
  it("tells the analyst how long to wait, not which env var sets the limit", async () => {
    // The route's own text is "Rate limit exceeded. Max 60 requests per 60s.
    // Raise RATE_LIMIT_MAX to change." — accurate, and aimed at the operator.
    stub(res(429, JSON.stringify({
      error: "Rate limit exceeded. Max 60 requests per 60s. Raise RATE_LIMIT_MAX to change.",
      retryAfter: 37,
    })));
    const out = await postLookup("/api/lookup", {});
    expect(out).toEqual({ ok: false, error: "Too many lookups in a row. Try again in 37s." });
  });

  it("reads the Retry-After header when the body carries no number", async () => {
    stub(res(429, "{}", { "retry-after": "12" }));
    expect((await postLookup("/api/lookup", {}) as { error: string }).error)
      .toBe("Too many lookups in a row. Try again in 12s.");
  });

  it("stays useful when neither says how long", async () => {
    stub(res(429, ""));
    expect((await postLookup("/api/lookup", {}) as { error: string }).error)
      .toBe("Too many lookups in a row. Try again shortly.");
  });

  it("ignores a Retry-After that is not a number", async () => {
    stub(res(429, "{}", { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    expect((await postLookup("/api/lookup", {}) as { error: string }).error)
      .toBe("Too many lookups in a row. Try again shortly.");
  });
});

describe("the genuinely offline case still reads as offline", () => {
  it("says so only when fetch itself rejects", async () => {
    stub(() => { throw new TypeError("Failed to fetch"); });
    expect(await postLookup("/api/lookup", {})).toEqual({
      ok: false, error: "Couldn't reach the server. Check your connection and try again.",
    });
  });

  it("reports a 200 whose body is not JSON as malformed, not as offline", async () => {
    stub(res(200, "<html>proxy interstitial</html>"));
    expect(await postLookup("/api/lookup", {})).toEqual({
      ok: false, error: "The server returned a malformed response.",
    });
  });

  it("treats an empty 200 body the same way", async () => {
    stub(res(200, ""));
    expect((await postLookup("/api/lookup", {}) as { error: string }).error)
      .toBe("The server returned a malformed response.");
  });
});
