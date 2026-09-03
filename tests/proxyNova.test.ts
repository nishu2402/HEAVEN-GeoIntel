import { describe, it, expect, afterEach, vi } from "vitest";
import { maskSecret, parseComb, fetchComb } from "@/lib/server/proxyNova";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const resp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function stub(handler: (url: string) => Response | Promise<Response>) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => { seen.push(String(u)); return handler(String(u)); }));
  return seen;
}

describe("maskSecret", () => {
  it("fully stars a short secret and never returns empty", () => {
    expect(maskSecret("")).toBe("*");
    expect(maskSecret("ab")).toBe("**");
    expect(maskSecret("abcd")).toBe("****");
  });
  it("keeps only the first and last of a longer secret", () => {
    expect(maskSecret("hunter2")).toBe("h*****2");
    expect(maskSecret("abcde")).toBe("a***e");
  });
  it("caps the star run so a long secret does not leak its length", () => {
    expect(maskSecret("a".repeat(20))).toBe("a********a"); // 8 stars, not 18
  });
});

describe("parseComb: exact-login discipline", () => {
  it("returns nothing for a non-array body", () => {
    expect(parseComb("nope", "ada@example.com", 100))
      .toEqual({ pairs: 0, distinctPasswords: 0, capped: false, samples: [] });
  });

  it("keeps only lines whose login is exactly the email, masking the rest", () => {
    const out = parseComb(
      [
        "ada@example.com:hunter2",
        "ada@example.com:hunter2",     // duplicate password
        "OTHER@z.com:secretpw",        // different login → dropped (this is the FP guard)
        "ada@example.com:",            // empty password → dropped
        "nopunct",                     // no separator → dropped
        ":leadingcolon",               // separator at 0 → dropped
        "ada@example.com:s3cret!",
        42,                            // non-string → dropped
      ],
      "ada@example.com",
      100,
    );
    expect(out.pairs).toBe(3);              // hunter2, hunter2, s3cret!
    expect(out.distinctPasswords).toBe(2);  // hunter2, s3cret!
    expect(out.capped).toBe(false);
    expect(out.samples).toEqual(["h*****2", "s*****!"]);
  });

  it("matches the login case-insensitively", () => {
    const out = parseComb(["ADA@Example.com:pass1234"], "ada@example.com", 100);
    expect(out.pairs).toBe(1);
  });

  it("flags capped when the source returned a full page", () => {
    const out = parseComb(["ada@example.com:onlyone", "x@y.com:z"], "ada@example.com", 2);
    expect(out.capped).toBe(true);
    expect(out.pairs).toBe(1);
  });

  it("caps the masked sample list", () => {
    const lines = Array.from({ length: 8 }, (_, i) => `ada@example.com:password${i}`);
    const out = parseComb(lines, "ada@example.com", 100);
    expect(out.distinctPasswords).toBe(8);
    expect(out.samples).toHaveLength(6);
  });
});

describe("fetchComb", () => {
  it("parses exact matches from a live-shaped body", async () => {
    const seen = stub(() => resp(200, { count: 10000, lines: ["ada@example.com:hunter2"] }));
    const r = await fetchComb("ada@example.com");
    expect(r.ok).toBe(true);
    expect(r.data?.pairs).toBe(1);
    expect(seen[0]).toContain("query=ada%40example.com");
    expect(seen[0]).toContain("limit=100");
  });

  it("treats a truncated fuzzy-only page as clean, not breached", async () => {
    // The false-positive case: COMB returns unrelated logins for an unknown
    // address. None match exactly, so the honest answer is zero exposure.
    stub(() => resp(200, { count: 10000, lines: ["9931@wes.com:9931", "nonexistent@aol.com:hottiee"] }));
    const r = await fetchComb("zzq-nobody-1234@nope.invalid");
    expect(r).toEqual({ ok: true, data: { pairs: 0, distinctPasswords: 0, capped: false, samples: [] } });
  });

  it("returns EMPTY when the body carries no lines field", async () => {
    stub(() => resp(200, { count: 0 }));
    const r = await fetchComb("ada@example.com");
    expect(r.data).toEqual({ pairs: 0, distinctPasswords: 0, capped: false, samples: [] });
  });

  it("reports rate limiting and other HTTP failures", async () => {
    stub(() => resp(429, {}));
    expect(await fetchComb("ada@example.com")).toEqual({ ok: false, error: "RATE_LIMITED" });
    stub(() => resp(503, {}));
    expect(await fetchComb("ada@example.com")).toEqual({ ok: false, error: "HTTP 503" });
  });

  it("treats an error body as a failed call, never a clean result", async () => {
    stub(() => resp(200, { error: "Search ?query must be at least FOUR characters long" }));
    expect(await fetchComb("a@b.c")).toEqual({ ok: false, error: "rejected by source" });
  });

  it("never throws on a network error", async () => {
    stub(() => { throw new Error("boom"); });
    expect(await fetchComb("ada@example.com")).toEqual({ ok: false, error: "request failed" });
  });
});
