import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { CLIENT_ID_COOKIE } from "@/lib/server/rateLimit";

// src/proxy.ts is the app's only security boundary: the always-on CSRF guard,
// the body-size cap, and the optional HTTP Basic gate that the README
// recommends before exposing the console on a LAN. It had no direct tests until
// 1.4, which is why it was brought inside the coverage gate.

afterEach(() => {
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_USER;
  delete process.env.FORCE_HTTPS;
});

function req(
  method: string,
  headers: Record<string, string> = {},
  url = "http://localhost:3000/api/lookup"
): NextRequest {
  return new NextRequest(new Request(url, { method, headers }));
}

const basic = (user: string, pass: string) =>
  "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

describe("matcher", () => {
  it("excludes static assets and the health probe", () => {
    const matcher = config.matcher[0];
    // The health endpoint must stay reachable without credentials so container
    // probes work when AUTH_PASSWORD is set.
    for (const excluded of ["_next/static", "_next/image", "favicon.ico", "robots.txt", "api/health"]) {
      expect(matcher).toContain(excluded);
    }
  });
});

describe("CSRF guard (always on)", () => {
  it("blocks a cross-site state-changing request", async () => {
    const res = proxy(req("POST", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Cross-site request blocked");
  });

  it("allows same-origin and same-site writes", () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      expect(proxy(req("POST", { "sec-fetch-site": site })).status).toBe(200);
    }
  });

  it("never blocks a safe method, whatever Sec-Fetch-Site says", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(proxy(req(method, { "sec-fetch-site": "cross-site" })).status).toBe(200);
    }
  });

  it("falls back to comparing Origin against Host on older browsers", () => {
    const blocked = proxy(req("POST", { origin: "https://evil.test", host: "localhost:3000" }));
    expect(blocked.status).toBe(403);

    const allowed = proxy(req("POST", { origin: "http://localhost:3000", host: "localhost:3000" }));
    expect(allowed.status).toBe(200);
  });

  it("blocks a malformed Origin rather than failing open", () => {
    expect(proxy(req("POST", { origin: "))not a url((", host: "localhost:3000" })).status).toBe(403);
  });

  it("allows a non-browser client that sends no Origin at all", () => {
    // curl / server-to-server: no Origin ⇒ not a CSRF vector.
    expect(proxy(req("POST", {})).status).toBe(200);
  });

  it("covers every unsafe method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(proxy(req(method, { "sec-fetch-site": "cross-site" })).status, method).toBe(403);
    }
  });
});

describe("body-size cap", () => {
  it("rejects an oversized declared body with 413", async () => {
    const res = proxy(req("POST", { "content-length": String(1024 * 1024) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("Request body too large");
  });

  it("allows a body at or under the cap, and one with no content-length", () => {
    expect(proxy(req("POST", { "content-length": String(512 * 1024) })).status).toBe(200);
    expect(proxy(req("POST", {})).status).toBe(200);
  });

  it("ignores content-length on a safe method", () => {
    expect(proxy(req("GET", { "content-length": String(1024 * 1024) })).status).toBe(200);
  });
});

describe("auth gate (opt-in via AUTH_PASSWORD)", () => {
  it("is disabled by default: no credentials needed", () => {
    expect(proxy(req("GET")).status).toBe(200);
  });

  it("challenges an unauthenticated request once enabled", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = proxy(req("GET"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('Basic realm="HEAVEN-GeoIntel"');
  });

  it("accepts the default analyst user with the right password", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET", { authorization: basic("analyst", "hunter2") })).status).toBe(200);
  });

  it("honours a custom AUTH_USER", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    process.env.AUTH_USER = "nisarg";
    expect(proxy(req("GET", { authorization: basic("nisarg", "hunter2") })).status).toBe(200);
    expect(proxy(req("GET", { authorization: basic("analyst", "hunter2") })).status).toBe(401);
  });

  it("rejects a wrong password, a wrong user, and both wrong", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET", { authorization: basic("analyst", "wrong") })).status).toBe(401);
    expect(proxy(req("GET", { authorization: basic("mallory", "hunter2") })).status).toBe(401);
    expect(proxy(req("GET", { authorization: basic("mallory", "wrong") })).status).toBe(401);
  });

  it("rejects a password of a different length (the length short-circuit)", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET", { authorization: basic("analyst", "hunter22") })).status).toBe(401);
  });

  it("rejects a non-Basic scheme and a missing header", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET", { authorization: "Bearer abc" })).status).toBe(401);
    expect(proxy(req("GET")).status).toBe(401);
  });

  it("rejects a Basic header with no colon separator", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const header = "Basic " + Buffer.from("nocolonhere").toString("base64");
    expect(proxy(req("GET", { authorization: header })).status).toBe(401);
  });

  it("rejects undecodable base64 without throwing", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET", { authorization: "Basic !!!not-base64!!!" })).status).toBe(401);
  });

  it("still runs the CSRF guard before authenticating", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = proxy(req("POST", {
      "sec-fetch-site": "cross-site",
      authorization: basic("analyst", "hunter2"),
    }));
    expect(res.status).toBe(403); // cross-site wins over valid credentials
  });
});

describe("rate-limit client cookie", () => {
  it("mints an opaque id on the first pass-through", () => {
    const res = proxy(req("GET"));
    const cookie = res.cookies.get(CLIENT_ID_COOKIE);
    expect(cookie?.value).toMatch(/^[0-9a-f]{32}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("does not overwrite an id the browser already has", () => {
    const existing = "a".repeat(32);
    const res = proxy(req("GET", { cookie: `${CLIENT_ID_COOKIE}=${existing}` }));
    expect(res.cookies.get(CLIENT_ID_COOKIE)).toBeUndefined(); // nothing re-set
  });

  it("marks the cookie Secure only for a declared TLS deployment", () => {
    expect(proxy(req("GET")).cookies.get(CLIENT_ID_COOKIE)?.secure).toBe(false);
    process.env.FORCE_HTTPS = "1";
    expect(proxy(req("GET")).cookies.get(CLIENT_ID_COOKIE)?.secure).toBe(true);
  });

  it("mints the id on an authenticated pass-through too", () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = proxy(req("GET", { authorization: basic("analyst", "hunter2") }));
    expect(res.cookies.get(CLIENT_ID_COOKIE)?.value).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not mint an id on a blocked request", () => {
    expect(proxy(req("POST", { "sec-fetch-site": "cross-site" })).cookies.get(CLIENT_ID_COOKIE)).toBeUndefined();
    process.env.AUTH_PASSWORD = "hunter2";
    expect(proxy(req("GET")).cookies.get(CLIENT_ID_COOKIE)).toBeUndefined();
  });
});
