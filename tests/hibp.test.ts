import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchHibp, parseHibpBreaches } from "@/lib/server/hibp";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.HIBP_API_KEY;
});

const resp = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init?: RequestInit) => {
    calls.push({ url: String(u), init });
    return handler(String(u), init);
  }));
  return calls;
}

describe("parseHibpBreaches", () => {
  it("maps full rows and applies every field fallback", () => {
    const rows = [
      {
        Name: "  Adobe  ", Title: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04",
        PwnCount: 152000000, DataClasses: ["Email addresses", "Passwords", 42, "  "], IsVerified: true,
      },
      // Title missing → name comes from Name; Domain/date missing → ""; PwnCount
      // non-number → 0; DataClasses missing → []; IsVerified not true → false.
      { Name: "Bare", PwnCount: "lots", IsVerified: 1 },
      // Only a Title → used as the name.
      { Title: "TitleOnly", DataClasses: "not-an-array" },
    ];
    const out = parseHibpBreaches(rows);
    expect(out).toEqual([
      { name: "Adobe", title: "Adobe", domain: "adobe.com", breachDate: "2013-10-04", pwnCount: 152000000, dataClasses: ["Email addresses", "Passwords"], verified: true },
      { name: "Bare", title: "Bare", domain: "", breachDate: "", pwnCount: 0, dataClasses: [], verified: false },
      { name: "TitleOnly", title: "TitleOnly", domain: "", breachDate: "", pwnCount: 0, dataClasses: [], verified: false },
    ]);
  });

  it("drops junk rows and non-array input", () => {
    expect(parseHibpBreaches(null)).toEqual([]);
    expect(parseHibpBreaches({ not: "an array" })).toEqual([]);
    // A null, a primitive, and a row with no name at all are all skipped.
    expect(parseHibpBreaches([null, "str", { Domain: "x.com" }])).toEqual([]);
  });
});

describe("fetchHibp", () => {
  it("skips the request and reports NOT_CONFIGURED without a key", async () => {
    const calls = stub(() => resp(200, []));
    const r = await fetchHibp("ada@example.com");
    expect(r).toEqual({ ok: false, error: "NOT_CONFIGURED" });
    expect(calls.length).toBe(0); // no doomed request
  });

  it("sends the key + truncateResponse=false and parses a hit", async () => {
    process.env.HIBP_API_KEY = "test-hibp";
    const calls = stub(() => resp(200, [
      { Name: "Adobe", Title: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04", PwnCount: 100, DataClasses: ["Passwords"], IsVerified: true },
      { Name: "LinkedIn", Title: "LinkedIn", Domain: "linkedin.com", BreachDate: "2012-05-05", PwnCount: 200, DataClasses: ["Email addresses"], IsVerified: true },
    ]));
    const r = await fetchHibp("ada@example.com");
    expect(r.ok).toBe(true);
    expect(r.data?.breachCount).toBe(2);
    expect(r.data?.breaches.map((b) => b.name)).toEqual(["Adobe", "LinkedIn"]);
    // The request carried the key header and the full-response flag.
    expect(calls[0].url).toContain("truncateResponse=false");
    expect(calls[0].url).toContain("ada%40example.com");
    expect((calls[0].init?.headers as Record<string, string>)["hibp-api-key"]).toBe("test-hibp");
  });

  it("treats 404 as a clean, breach-free answer", async () => {
    process.env.HIBP_API_KEY = "test-hibp";
    stub(() => resp(404, "Not found"));
    const r = await fetchHibp("clean@example.com");
    expect(r).toEqual({ ok: true, data: { breachCount: 0, breaches: [] } });
  });

  it("reports UNAUTHORIZED on 401, RATE_LIMITED on 429, and HTTP on other errors", async () => {
    process.env.HIBP_API_KEY = "test-hibp";
    stub(() => resp(401, {}));
    expect(await fetchHibp("a@x.com")).toEqual({ ok: false, error: "UNAUTHORIZED" });
    stub(() => resp(429, {}));
    expect(await fetchHibp("a@x.com")).toEqual({ ok: false, error: "RATE_LIMITED" });
    stub(() => resp(503, {}));
    expect(await fetchHibp("a@x.com")).toEqual({ ok: false, error: "HTTP 503" });
  });

  it("surfaces a network failure as an error, never as clean", async () => {
    process.env.HIBP_API_KEY = "test-hibp";
    stub(() => { throw new Error("network down"); });
    const r = await fetchHibp("a@x.com");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBeTruthy();
  });
});
