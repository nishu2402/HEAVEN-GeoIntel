import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, fetchAll, describeError, type FetchResult } from "@/lib/server/fetchSafe";

// The resilient-fetch layer every OSINT source call goes through. Contract:
// never throw, always attach provenance (source/fetchedAt/ms), and turn every
// failure mode into a short, user-safe reason (never a raw error/URL).

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns ok + data + provenance on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, { hello: "world" })));
    const r = await fetchJson<{ hello: string }>("https://x.test", { source: "TestSrc" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ hello: "world" });
    expect(r.source).toBe("TestSrc");
    expect(typeof r.fetchedAt).toBe("number");
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(r.error).toBeUndefined();
  });

  it("maps non-2xx status codes to safe reasons (no body leaked)", async () => {
    const cases: [number, string][] = [
      [404, "not found"],
      [429, "rate-limited by source"],
      [500, "source error (HTTP 500)"],
      [403, "rejected (HTTP 403)"],
      [300, "HTTP 300"], // falls through to the generic reason
    ];
    for (const [status, reason] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => resp(status, { secret: "x" })));
      const r = await fetchJson("https://x.test", { source: "S" });
      expect(r.ok, String(status)).toBe(false);
      expect(r.status, String(status)).toBe(status);
      expect(r.error, String(status)).toBe(reason);
      expect(r.data, String(status)).toBeUndefined();
    }
  });

  it("still parses a non-2xx body when allowNon2xx is set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(404, { detail: "soft" })));
    const r = await fetchJson<{ detail: string }>("https://x.test", { source: "S", allowNon2xx: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ detail: "soft" });
  });

  it("reports invalid JSON without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }) as unknown as Response));
    const r = await fetchJson("https://x.test", { source: "S" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid JSON from source");
  });

  it("maps a network failure to status 0 / unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    const r = await fetchJson("https://x.test", { source: "S" });
    expect(r.status).toBe(0);
    expect(r.error).toBe("unreachable");
  });

  it("maps an abort-timeout to 'timed out'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    const r = await fetchJson("https://x.test", { source: "S", timeoutMs: 1 });
    expect(r.status).toBe(0);
    expect(r.error).toBe("timed out");
  });

  it("maps an explicit AbortError to 'aborted'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("stop", "AbortError"); }));
    const r = await fetchJson("https://x.test", { source: "S" });
    expect(r.status).toBe(0);
    expect(r.error).toBe("aborted");
  });
});

describe("describeError", () => {
  it("maps known abort kinds and hides everything else", () => {
    expect(describeError(new DOMException("t", "TimeoutError"))).toBe("timed out");
    expect(describeError(new DOMException("a", "AbortError"))).toBe("aborted");
    expect(describeError(new Error("https://secret.internal/key=abc"))).toBe("request failed");
    expect(describeError("weird")).toBe("request failed");
  });
});

describe("fetchAll", () => {
  it("returns every result in order and converts a rejected job to a safe failure", async () => {
    const good: FetchResult<number> = { ok: true, status: 200, data: 1, source: "A", fetchedAt: Date.now(), ms: 5 };
    const results = await fetchAll<number>([
      Promise.resolve(good),
      Promise.reject(new Error("boom")),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBe("unexpected failure");
  });
});
