import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchLeakCheck, leakCheckQuery } from "@/lib/server/leakCheck";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function stub(handler: (url: string) => Response | Promise<Response>) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    seen.push(String(u));
    return handler(String(u));
  }));
  return seen;
}

describe("leakCheckQuery", () => {
  it("sends bare digits and an explicit type for a phone", () => {
    // Verified against the live endpoint: "+1415…" is rejected with
    // "Could not determine search type automatically"; digits + type work.
    expect(leakCheckQuery("+1 (415) 555-2671", "phone")).toBe("check=14155552671&type=phone");
  });

  it("lets the endpoint auto-detect an email or username", () => {
    expect(leakCheckQuery("ada@example.com", "email")).toBe("check=ada%40example.com");
    expect(leakCheckQuery("torvalds", "username")).toBe("check=torvalds");
  });
});

describe("fetchLeakCheck", () => {
  it("parses a hit, keeping named breaches and dropping empty dates", async () => {
    stub(() => resp(200, {
      success: true,
      found: 3,
      fields: ["password", "username", 42, ""],
      sources: [
        { name: "Trello.com", date: "2024-01" },
        { name: " Spaced ", date: "  " },
        { name: "", date: "2020-01" },   // no name → dropped
        "not-an-object",                  // wrong shape → dropped
      ],
    }));
    const r = await fetchLeakCheck("ada@example.com", "email");
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({
      found: 3,
      fields: ["password", "username"],   // non-strings and blanks dropped
      sources: [
        { name: "Trello.com", date: "2024-01" },
        { name: "Spaced", date: null },   // blank date → null, not ""
      ],
    });
  });

  it("treats a not-found response as a clean answer, not a failure", async () => {
    stub(() => resp(200, { success: false, error: "Not found" }));
    const r = await fetchLeakCheck("nobody@example.com", "email");
    expect(r).toEqual({ ok: true, data: { found: 0, fields: [], sources: [] } });
  });

  it("treats a rejected query as a FAILURE, never as 'no exposure'", async () => {
    // The endpoint answers 200 for this, so a naive parser would report the
    // identifier as clean when it was never actually searched.
    stub(() => resp(200, { success: false, error: "Could not determine search type automatically" }));
    const r = await fetchLeakCheck("+919876543210", "email");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/determine search type/i);
  });

  it("falls back to a generic reason when a rejection carries no message", async () => {
    stub(() => resp(200, { success: false }));
    expect(await fetchLeakCheck("x@y.com", "email")).toEqual({ ok: false, error: "rejected by source" });
  });

  it("reports rate limiting distinctly from other HTTP errors", async () => {
    stub(() => resp(429, {}));
    expect(await fetchLeakCheck("a@b.com", "email")).toEqual({ ok: false, error: "RATE_LIMITED" });
    stub(() => resp(503, {}));
    expect(await fetchLeakCheck("a@b.com", "email")).toEqual({ ok: false, error: "HTTP 503" });
  });

  it("defaults a missing or non-finite `found` to zero", async () => {
    stub(() => resp(200, { success: true, found: "many" }));
    expect((await fetchLeakCheck("a@b.com", "email")).data?.found).toBe(0);
    stub(() => resp(200, { success: true, found: Number.NaN }));
    expect((await fetchLeakCheck("a@b.com", "email")).data?.found).toBe(0);
  });

  it("tolerates a non-array fields/sources payload", async () => {
    stub(() => resp(200, { success: true, found: 1, fields: "password", sources: { name: "x" } }));
    expect((await fetchLeakCheck("a@b.com", "email")).data).toEqual({ found: 1, fields: [], sources: [] });
  });

  it("never throws when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchLeakCheck("a@b.com", "email")).toEqual({ ok: false, error: "request failed" });
  });

  it("honours SOURCE_TIMEOUT_MS", async () => {
    process.env.SOURCE_TIMEOUT_MS = "1500";
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init);
      return resp(200, { success: true, found: 0 });
    }));
    await fetchLeakCheck("a@b.com", "email");
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    delete process.env.SOURCE_TIMEOUT_MS;
  });
});
