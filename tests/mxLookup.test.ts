import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchEmailMx, parseMxAnswers } from "@/lib/server/mxLookup";

afterEach(() => vi.unstubAllGlobals());

const resp = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

describe("parseMxAnswers", () => {
  it("returns an empty list when there is no Answer section", () => {
    expect(parseMxAnswers(undefined)).toEqual([]);
  });
  it("splits priority and host, tolerating a missing host or a non-numeric priority", () => {
    expect(parseMxAnswers([
      { name: "x", type: 15, TTL: 300, data: "10 aspmx.l.google.com." },
      { name: "x", type: 15, TTL: 300, data: "20 ." },          // no host after the dot -> dropped
      { name: "x", type: 15, TTL: 300, data: "bogus mail.self.test" }, // non-numeric priority -> null
    ])).toEqual([
      { host: "aspmx.l.google.com", priority: 10 },
      { host: "mail.self.test", priority: null },
    ]);
  });
});

describe("fetchEmailMx", () => {
  it("guards an empty domain without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchEmailMx("  ")).toEqual({ ok: false, error: "no domain" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves MX over DoH and fingerprints the provider", async () => {
    let calledUrl = "";
    let init: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (u: string | URL, i?: RequestInit) => {
      calledUrl = String(u); init = i;
      return resp(200, { Answer: [
        { name: "example.com", type: 15, TTL: 300, data: "1 aspmx.l.google.com." },
        { name: "example.com", type: 15, TTL: 300, data: "5 alt1.aspmx.l.google.com." },
      ] });
    }));
    const r = await fetchEmailMx("Example.com");
    expect(r.ok).toBe(true);
    expect(r.data?.hasMx).toBe(true);
    expect(r.data?.provider).toBe("Google Workspace");
    expect(r.data?.mxHosts[0]).toBe("aspmx.l.google.com");
    // queries MX for the lowercased domain over DoH, with the dns-json Accept header
    expect(calledUrl).toContain("cloudflare-dns.com");
    expect(calledUrl).toContain("name=example.com");
    expect(calledUrl).toContain("type=MX");
    expect(new Headers(init?.headers).get("Accept")).toBe("application/dns-json");
  });

  it("reports no exchangers (not a failure) when the domain publishes none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, {})));
    const r = await fetchEmailMx("no-mail.test");
    expect(r).toEqual({ ok: true, data: { hasMx: false, mxHosts: [], provider: "No published mail exchangers", category: "none" } });
  });

  it("surfaces a non-2xx as an explicit failure, never an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(500, {})));
    expect(await fetchEmailMx("boom.test")).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("surfaces a network error through describeError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("t", "TimeoutError"); }));
    expect(await fetchEmailMx("slow.test")).toEqual({ ok: false, error: "timed out" });
  });
});
