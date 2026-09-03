import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── node:tls stub ────────────────────────────────────────────────────────────
// probeTls talks to a socket, so the socket is what has to be faked. `scenario`
// drives which of the three outcomes the next connect() produces: a certificate,
// a timeout, or a connection error.
type Scenario = {
  mode: "ok" | "timeout" | "error";
  cert?: Record<string, unknown>;
  cipher?: { name: string } | null;
  protocol?: string | null;
  authorized?: boolean;
  authorizationError?: unknown;
  /** Fire an `error` event after the handshake callback has already run. */
  alsoErrorAfter?: boolean;
};
let scenario: Scenario = { mode: "ok" };

vi.mock("node:tls", () => ({
  default: {
    connect: (_opts: unknown, onSecure: () => void) => {
      const handlers: Record<string, () => void> = {};
      const socket = {
        getPeerCertificate: () => scenario.cert,
        getCipher: () => (scenario.cipher === undefined ? { name: "TLS_AES_128_GCM_SHA256" } : scenario.cipher),
        getProtocol: () => (scenario.protocol === undefined ? "TLSv1.3" : scenario.protocol),
        get authorized() { return scenario.authorized !== false; },
        get authorizationError() { return scenario.authorizationError; },
        destroy: () => {},
        on: (evt: string, fn: () => void) => { handlers[evt] = fn; return socket; },
      };
      queueMicrotask(() => {
        if (scenario.mode === "ok") {
          onSecure();
          if (scenario.alsoErrorAfter) handlers.error?.();
        } else {
          handlers[scenario.mode === "timeout" ? "timeout" : "error"]?.();
        }
      });
      return socket;
    },
  },
}));

const { probeHttp, probeTls, isProbeTarget } = await import("@/lib/server/httpProbe");

const PUBLIC_IP = "93.184.216.34";

function res(init: {
  status?: number; headers?: Record<string, string>; body?: string; setCookie?: string[];
}): Response {
  const h = new Headers(init.headers ?? {});
  const r = new Response(init.body ?? null, { status: init.status ?? 200, headers: h });
  // Response.headers has no Location on a 3xx unless we put it there, and
  // getSetCookie is what headerMap prefers — both are stubbed explicitly.
  if (init.setCookie) {
    Object.defineProperty(r.headers, "getSetCookie", { value: () => init.setCookie, configurable: true });
  }
  Object.defineProperty(r, "status", { value: init.status ?? 200, configurable: true });
  return r;
}

beforeEach(() => { scenario = { mode: "ok", cert: {} }; });
afterEach(() => { vi.restoreAllMocks(); });

describe("isProbeTarget", () => {
  it("refuses an empty address list: nothing resolved is nothing to probe", () => {
    expect(isProbeTarget([])).toBe(false);
  });

  it("accepts a globally routable address", () => {
    expect(isProbeTarget([PUBLIC_IP])).toBe(true);
  });

  it.each(["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "::1"])(
    "refuses %s", (ip) => { expect(isProbeTarget([ip])).toBe(false); },
  );

  it("refuses a split-horizon answer where only one address is internal", () => {
    expect(isProbeTarget([PUBLIC_IP, "127.0.0.1"])).toBe(false);
  });

  it("refuses an address it cannot classify at all", () => {
    expect(isProbeTarget(["not-an-ip"])).toBe(false);
  });
});

describe("probeTls", () => {
  it("reads the certificate, cipher and protocol off the socket", async () => {
    scenario = {
      mode: "ok",
      cert: {
        subject: { CN: "example.com" },
        issuer: { O: "Let's Encrypt", CN: "R3" },
        valid_from: "Jan  1 00:00:00 2026 GMT",
        valid_to: "Dec 31 23:59:59 2099 GMT",
        subjectaltname: "DNS:example.com, DNS:www.example.com",
      },
    };
    const out = (await probeTls("example.com"))!;
    expect(out.subject).toBe("example.com");
    expect(out.issuer).toBe("Let's Encrypt");
    expect(out.protocol).toBe("TLSv1.3");
    expect(out.cipher).toBe("TLS_AES_128_GCM_SHA256");
    expect(out.altNames).toEqual(["example.com", "www.example.com"]);
    expect(out.validFrom).toBe("2026-01-01");
    expect(out.daysRemaining).toBeGreaterThan(0);
    expect(out.trusted).toBe(true);
    expect(out.trustError).toBeNull();
  });

  it("reports a negative daysRemaining for an expired certificate", async () => {
    scenario = { mode: "ok", cert: { valid_to: "Jan  1 00:00:00 2001 GMT" } };
    expect((await probeTls("x.com"))!.daysRemaining).toBeLessThan(0);
  });

  it("falls back to the issuer CN when there is no O", async () => {
    scenario = { mode: "ok", cert: { issuer: { CN: "Some CA" } } };
    expect((await probeTls("x.com"))!.issuer).toBe("Some CA");
  });

  it("joins a distinguished-name field that repeats an attribute", async () => {
    scenario = { mode: "ok", cert: { issuer: { O: ["A Ltd", "B Ltd"] }, subject: { CN: ["a.com", "b.com"] } } };
    const out = (await probeTls("x.com"))!;
    expect(out.issuer).toBe("A Ltd, B Ltd");
    expect(out.subject).toBe("a.com, b.com");
  });

  it("reports a null issuer when the certificate carries no issuer at all", async () => {
    scenario = { mode: "ok", cert: {} };
    const out = (await probeTls("x.com"))!;
    expect(out.issuer).toBeNull();
    expect(out.subject).toBeNull();
    expect(out.altNames).toEqual([]);
  });

  it("nulls the dates when they cannot be parsed or are absent", async () => {
    scenario = { mode: "ok", cert: { valid_to: "not a date" } };
    const out = (await probeTls("x.com"))!;
    expect(out.validTo).toBeNull();
    expect(out.daysRemaining).toBeNull();
    expect(out.validFrom).toBeNull();
  });

  it("records an untrusted chain as a finding rather than a failure", async () => {
    scenario = {
      mode: "ok", cert: {}, authorized: false,
      authorizationError: new Error("self signed certificate"),
    };
    const out = (await probeTls("x.com"))!;
    expect(out.trusted).toBe(false);
    expect(out.trustError).toBe("self signed certificate");
  });

  it("stringifies a non-Error authorizationError", async () => {
    scenario = { mode: "ok", cert: {}, authorized: false, authorizationError: "CERT_HAS_EXPIRED" };
    expect((await probeTls("x.com"))!.trustError).toBe("CERT_HAS_EXPIRED");
  });

  it("describes an untrusted chain with no error object at all", async () => {
    scenario = { mode: "ok", cert: {}, authorized: false, authorizationError: undefined };
    expect((await probeTls("x.com"))!.trustError).toBe("untrusted");
  });

  it("handles a null cipher and protocol", async () => {
    scenario = { mode: "ok", cert: {}, cipher: null, protocol: null };
    const out = (await probeTls("x.com"))!;
    expect(out.cipher).toBeNull();
    expect(out.protocol).toBeNull();
  });

  it("ignores a socket error that arrives after the handshake already resolved", async () => {
    scenario = { mode: "ok", cert: { valid_to: "Dec 31 23:59:59 2099 GMT" }, alsoErrorAfter: true };
    const out = await probeTls("x.com");
    expect(out).not.toBeNull();
    expect(out!.trusted).toBe(true);
  });

  it("returns null on timeout", async () => {
    scenario = { mode: "timeout" };
    expect(await probeTls("x.com")).toBeNull();
  });

  it("returns null on a socket error", async () => {
    scenario = { mode: "error" };
    expect(await probeTls("x.com")).toBeNull();
  });
});

describe("probeHttp", () => {
  it("returns null without probing when the SSRF guard refuses the target", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await probeHttp("internal.corp", ["127.0.0.1"])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("collects headers, body signals, cookies and TLS for a live site", async () => {
    scenario = { mode: "ok", cert: { valid_to: "Dec 31 23:59:59 2099 GMT" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://")) return res({ status: 301, headers: { location: "https://example.com/" } });
      return res({
        status: 200,
        headers: { server: "nginx/1.24.0", "strict-transport-security": "max-age=31536000" },
        setCookie: ["sid=1; Secure; HttpOnly; SameSite=Lax"],
        body: "<html><head><title>  Example   Domain </title></head><body>/_next/static/x.js</body></html>",
      });
    });

    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.status).toBe(200);
    expect(out.title).toBe("Example Domain");
    expect(out.httpsRedirect).toBe(true);
    expect(out.redirectChain).toEqual([]);
    expect(out.security.grade).toBeDefined();
    expect(out.tech.map((t) => t.name)).toEqual(expect.arrayContaining(["nginx", "Next.js"]));
    expect(out.disclosures[0]).toMatchObject({ header: "server", hasVersion: true });
    expect(out.cookies).toEqual([{ name: "sid", secure: true, httpOnly: true, sameSite: "lax" }]);
    expect(out.tls!.daysRemaining).toBeGreaterThan(0);
  });

  it("records each redirect hop as evidence", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("http://")) return res({ status: 200 });
      n += 1;
      if (n === 1) return res({ status: 301, headers: { location: "/en" } });
      if (n === 2) return res({ status: 302, headers: { location: "https://www.example.com/en" } });
      return res({ status: 200, body: "<title>Done</title>" });
    });
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.redirectChain).toHaveLength(2);
    expect(out.redirectChain[0]).toContain("301 https://example.com/ → https://example.com/en");
    expect(out.url).toBe("https://www.example.com/en");
  });

  it("gives up after the redirect ceiling instead of looping", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("http://")
        ? res({ status: 200 })
        : res({ status: 302, headers: { location: "https://example.com/next" } }));
    expect(await probeHttp("example.com", [PUBLIC_IP])).toBeNull();
  });

  it("returns null when https is unreachable on the first hop", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("http://")) return res({ status: 200 });
      throw new Error("ECONNREFUSED");
    });
    expect(await probeHttp("parked.example", [PUBLIC_IP])).toBeNull();
  });

  it("returns null when the connection dies partway through a redirect chain", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("http://")) return res({ status: 200 });
      n += 1;
      if (n === 1) return res({ status: 301, headers: { location: "https://example.com/x" } });
      throw new Error("ECONNRESET");
    });
    expect(await probeHttp("example.com", [PUBLIC_IP])).toBeNull();
  });

  it("reports httpsRedirect false when http serves content directly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res({ status: 200, body: "<title>T</title>" }));
    expect((await probeHttp("example.com", [PUBLIC_IP]))!.httpsRedirect).toBe(false);
  });

  it("reports httpsRedirect false when http redirects back to http", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("http://")
        ? res({ status: 301, headers: { location: "http://example.com/home" } })
        : res({ status: 200, body: "<title>T</title>" }));
    expect((await probeHttp("example.com", [PUBLIC_IP]))!.httpsRedirect).toBe(false);
  });

  it("reports httpsRedirect null when port 80 is closed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("http://")) throw new Error("ECONNREFUSED");
      return res({ status: 200, body: "<title>T</title>" });
    });
    expect((await probeHttp("example.com", [PUBLIC_IP]))!.httpsRedirect).toBeNull();
  });

  it("ignores a 3xx that carries no Location header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).startsWith("http://") ? res({ status: 304 }) : res({ status: 304 }));
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.status).toBe(304);
    expect(out.redirectChain).toEqual([]);
    expect(out.httpsRedirect).toBe(false);
  });

  it("decodes character references in the page title", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      res({ status: 200, body: "<title>Blog Tool, Publishing Platform, and CMS &#8211; WordPress.org</title>" }));
    const out = (await probeHttp("wordpress.org", [PUBLIC_IP]))!;
    expect(out.title).toBe("Blog Tool, Publishing Platform, and CMS \u2013 WordPress.org");
  });

  it("copes with a response that has no body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res({ status: 204 }));
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.title).toBeNull();
    expect(out.tech).toEqual([]);
  });

  it("falls back to the folded header when getSetCookie is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      res({ status: 200, headers: { "set-cookie": "a=1; Secure" }, body: "<title>T</title>" }));
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.cookies).toEqual([{ name: "a", secure: true, httpOnly: false, sameSite: null }]);
  });

  it("copes with a getSetCookie that returns nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const r = res({ status: 200, headers: { "set-cookie": "a=1" }, body: "<title>T</title>" });
      Object.defineProperty(r.headers, "getSetCookie", { value: () => undefined, configurable: true });
      return r;
    });
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.cookies).toEqual([{ name: "a", secure: false, httpOnly: false, sameSite: null }]);
  });

  it("still reads cookies on a runtime with no getSetCookie at all", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const r = res({ status: 200, headers: { "set-cookie": "a=1; Secure" }, body: "<title>T</title>" });
      Object.defineProperty(r.headers, "getSetCookie", { value: undefined, configurable: true });
      return r;
    });
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.cookies).toEqual([{ name: "a", secure: true, httpOnly: false, sameSite: null }]);
  });

  it("truncates a very large body instead of buffering all of it", async () => {
    const huge = "x".repeat(200_000);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      res({ status: 200, body: `<title>Big</title>${huge}` }));
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.title).toBe("Big");
  });

  it("still fingerprints a body whose stream errors midway", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      let sent = false;
      const stream = new ReadableStream({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode("<title>Partial</title><link href='/wp-content/a.css'>"));
            return;
          }
          controller.error(new Error("stream broke"));
        },
      });
      const r = new Response(stream, { status: 200 });
      Object.defineProperty(r, "status", { value: 200, configurable: true });
      return r;
    });
    const out = (await probeHttp("example.com", [PUBLIC_IP]))!;
    expect(out.title).toBe("Partial");
    expect(out.tech.some((t) => t.name === "WordPress")).toBe(true);
  });

  it("returns a null tls block when the handshake fails but http works", async () => {
    scenario = { mode: "error" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res({ status: 200, body: "<title>T</title>" }));
    expect((await probeHttp("example.com", [PUBLIC_IP]))!.tls).toBeNull();
  });
});
