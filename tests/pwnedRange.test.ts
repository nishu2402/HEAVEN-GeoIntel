import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchPwnedRange } from "@/lib/server/pwnedRange";

afterEach(() => vi.unstubAllGlobals());

const textResp = (status: number, text: string) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => text }) as Response;

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL, init?: RequestInit) => {
    calls.push({ url: String(u), init });
    return handler(String(u), init);
  }));
  return calls;
}

describe("fetchPwnedRange", () => {
  it("rejects anything that is not a 5-hex prefix without touching the network", async () => {
    const calls = stub(() => textResp(200, ""));
    expect(await fetchPwnedRange("password")).toEqual({ ok: false, error: "BAD_PREFIX" });
    expect(calls.length).toBe(0);
  });

  it("sends the padded, identified request and returns the raw range", async () => {
    const calls = stub(() => textResp(200, "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n"));
    const r = await fetchPwnedRange("5baa6"); // lower-case in, upper-case out
    expect(r).toEqual({ ok: true, range: "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n" });
    expect(calls[0].url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Add-Padding"]).toBe("true");
    expect(headers["User-Agent"]).toContain("HEAVEN-GeoIntel");
  });

  it("maps a 429 to RATE_LIMITED and any other non-2xx to its status", async () => {
    stub(() => textResp(429, ""));
    expect(await fetchPwnedRange("5BAA6")).toEqual({ ok: false, error: "RATE_LIMITED" });
    stub(() => textResp(503, ""));
    expect(await fetchPwnedRange("5BAA6")).toEqual({ ok: false, error: "HTTP 503" });
  });

  it("surfaces a network failure as an error, never as an empty range", async () => {
    stub(() => { throw new Error("network down"); });
    const r = await fetchPwnedRange("5BAA6");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBeTruthy();
  });
});
