import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy, isOwnHost } from "@/proxy";
import { CLIENT_ID_COOKIE } from "@/lib/server/rateLimit";
import { resetAuthThrottle } from "@/lib/server/authThrottle";

// src/proxy.ts is the app's only security boundary: the always-on CSRF guard,
// the body-size cap, and the optional HTTP Basic gate that the README
// recommends before exposing the console on a LAN. It had no direct tests until
// 1.4, which is why it was brought inside the coverage gate.

afterEach(() => {
  delete process.env.AUTH_PASSWORD;
  delete process.env.AUTH_USER;
  delete process.env.FORCE_HTTPS;
  // The failed-password delay counts globally (see authThrottle.ts), so a test
  // that guesses wrong would otherwise slow the ones that follow it.
  resetAuthThrottle();
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
  it("excludes static assets and the health probe", async () => {
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
    const res = await proxy(req("POST", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Cross-site request blocked");
  });

  it("allows a same-origin write and a user-initiated one", async () => {
    for (const site of ["same-origin", "none"]) {
      expect((await proxy(req("POST", { "sec-fetch-site": site }))).status).toBe(200);
    }
  });

  it("blocks a same-site write: another localhost port is the same site", async () => {
    // A page on http://localhost:8080 posting here arrives as "same-site",
    // and so does a sibling subdomain of a hosted deployment. The app itself
    // only ever calls its own origin.
    const res = await proxy(req("POST", { "sec-fetch-site": "same-site" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Cross-site request blocked");
  });

  it("never blocks a safe method, whatever Sec-Fetch-Site says", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect((await proxy(req(method, { "sec-fetch-site": "cross-site" }))).status).toBe(200);
    }
  });

  it("falls back to comparing Origin against Host on older browsers", async () => {
    const blocked = await proxy(req("POST", { origin: "https://evil.test", host: "localhost:3000" }));
    expect(blocked.status).toBe(403);

    const allowed = await proxy(req("POST", { origin: "http://localhost:3000", host: "localhost:3000" }));
    expect(allowed.status).toBe(200);
  });

  it("blocks a malformed Origin rather than failing open", async () => {
    expect((await proxy(req("POST", { origin: "))not a url((", host: "localhost:3000" }))).status).toBe(403);
  });

  it("allows a non-browser client that sends no Origin at all", async () => {
    // curl / server-to-server: no Origin ⇒ not a CSRF vector.
    expect((await proxy(req("POST", {}))).status).toBe(200);
  });

  it("covers every unsafe method", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await proxy(req(method, { "sec-fetch-site": "cross-site" }))).status, method).toBe(403);
    }
  });
});

describe("host check (DNS rebinding)", () => {
  afterEach(() => { delete process.env.ALLOWED_HOSTS; });

  // A rebound page is same-origin with itself, so it sends no cross-site
  // signal at all: only the Host header still names the attacker's domain.
  const at = (host: string, method = "GET") => proxy(req(method, { host, "sec-fetch-site": "same-origin" }));

  it("refuses a public domain the operator never named, reads included", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await at("rebind.attacker.example:3000", method);
      expect(res.status, method).toBe(421);
      expect((await res.json()).error).toContain(`Host "rebind.attacker.example" is not allowed`);
    }
    // A trailing dot is the same name, and does not slip past.
    expect((await at("rebind.attacker.example.")).status).toBe(421);
  });

  it("does not mint a client cookie on a refused host", async () => {
    expect((await at("rebind.attacker.example")).cookies.get(CLIENT_ID_COOKIE)).toBeUndefined();
  });

  it("allows every way a local or LAN user reaches the app", async () => {
    for (const host of [
      "localhost:3000", "LOCALHOST", "localhost.", "127.0.0.1:3000", "192.168.1.20:3000", "[::1]:3000",
      "[fe80::1]", "raspberrypi:3000", "mac.local", "app.localhost", "box.internal", "nas.home.arpa",
    ]) {
      expect((await at(host)).status, host).toBe(200);
    }
  });

  it("allows a request with no Host header, which no browser sends", async () => {
    expect((await proxy(req("GET"))).status).toBe(200);
  });

  it("allows the names listed in ALLOWED_HOSTS, with *. matching subdomains", async () => {
    process.env.ALLOWED_HOSTS = " osint.example.com , *.tailnet.ts.net.,";
    expect((await at("osint.example.com")).status).toBe(200);
    expect((await at("OSINT.example.com:443")).status).toBe(200);
    expect((await at("box.tailnet.ts.net")).status).toBe(200);
    // The wildcard is for subdomains, and an exact name is only itself.
    expect((await at("tailnet.ts.net")).status).toBe(421);
    expect((await at("evil.osint.example.com")).status).toBe(421);
    expect((await at("osint.example.com.evil.test")).status).toBe(421);
  });

  it("leaves the host alone behind AUTH_PASSWORD: the rebound page cannot log in", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await at("osint.example.com")).status).toBe(401);
    expect((await proxy(req("GET", { host: "osint.example.com", authorization: basic("analyst", "hunter2") }))).status).toBe(200);
  });

  it("isOwnHost answers the same question directly", async () => {
    expect(isOwnHost(null)).toBe(true);
    expect(isOwnHost("10.0.0.5")).toBe(true);
    expect(isOwnHost("example.com")).toBe(false);
  });
});

describe("body-size cap", () => {
  it("rejects an oversized declared body with 413", async () => {
    const res = await proxy(req("POST", { "content-length": String(1024 * 1024) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("Request body too large");
  });

  it("allows a body at or under the cap, and one with no content-length", async () => {
    expect((await proxy(req("POST", { "content-length": String(512 * 1024) }))).status).toBe(200);
    expect((await proxy(req("POST", {}))).status).toBe(200);
  });

  it("ignores content-length on a safe method", async () => {
    expect((await proxy(req("GET", { "content-length": String(1024 * 1024) }))).status).toBe(200);
  });

  // The cap used to be one flat number for every route, which quietly made a
  // documented feature impossible: the evidence locker stores an artifact of up
  // to 4 MB, and every capture over 512 KB came back 413 from here. Verified
  // against the built server — a 900 KB capture was refused before this, and
  // stored after it.
  it("gives the document routes the room their own limits promise", async () => {
    const big = { "content-length": String(1024 * 1024) };
    expect((await proxy(req("POST", big, "http://localhost:3000/api/evidence"))).status).toBe(200);
    expect((await proxy(req("POST", big, "http://localhost:3000/api/cases"))).status).toBe(200);
  });

  it("still caps the document routes, just higher", async () => {
    const huge = { "content-length": String(8 * 1024 * 1024) };
    const res = await proxy(req("POST", huge, "http://localhost:3000/api/evidence"));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("Request body too large");
  });
});

describe("auth gate (opt-in via AUTH_PASSWORD)", async () => {
  it("is disabled by default: no credentials needed", async () => {
    expect((await proxy(req("GET"))).status).toBe(200);
  });

  it("challenges an unauthenticated request once enabled", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = await proxy(req("GET"));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('Basic realm="HEAVEN-GeoIntel"');
  });

  it("accepts the default analyst user with the right password", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET", { authorization: basic("analyst", "hunter2") }))).status).toBe(200);
  });

  it("honours a custom AUTH_USER", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    process.env.AUTH_USER = "operator";
    expect((await proxy(req("GET", { authorization: basic("operator", "hunter2") }))).status).toBe(200);
    expect((await proxy(req("GET", { authorization: basic("analyst", "hunter2") }))).status).toBe(401);
  });

  it("rejects a wrong password, a wrong user, and both wrong", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET", { authorization: basic("analyst", "wrong") }))).status).toBe(401);
    expect((await proxy(req("GET", { authorization: basic("mallory", "hunter2") }))).status).toBe(401);
    expect((await proxy(req("GET", { authorization: basic("mallory", "wrong") }))).status).toBe(401);
  });

  it("rejects a password of a different length (the length short-circuit)", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET", { authorization: basic("analyst", "hunter22") }))).status).toBe(401);
  });

  it("rejects a non-Basic scheme and a missing header", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET", { authorization: "Bearer abc" }))).status).toBe(401);
    expect((await proxy(req("GET"))).status).toBe(401);
  });

  it("rejects a Basic header with no colon separator", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const header = "Basic " + Buffer.from("nocolonhere").toString("base64");
    expect((await proxy(req("GET", { authorization: header }))).status).toBe(401);
  });

  it("rejects undecodable base64 without throwing", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET", { authorization: "Basic !!!not-base64!!!" }))).status).toBe(401);
  });

  it("still runs the CSRF guard before authenticating", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = await proxy(req("POST", {
      "sec-fetch-site": "cross-site",
      authorization: basic("analyst", "hunter2"),
    }));
    expect(res.status).toBe(403); // cross-site wins over valid credentials
  });
});

describe("rate-limit client cookie", () => {
  it("mints an opaque id on the first pass-through", async () => {
    const res = await proxy(req("GET"));
    const cookie = res.cookies.get(CLIENT_ID_COOKIE);
    expect(cookie?.value).toMatch(/^[0-9a-f]{32}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("does not overwrite an id the browser already has", async () => {
    const existing = "a".repeat(32);
    const res = await proxy(req("GET", { cookie: `${CLIENT_ID_COOKIE}=${existing}` }));
    expect(res.cookies.get(CLIENT_ID_COOKIE)).toBeUndefined(); // nothing re-set
  });

  it("marks the cookie Secure only for a declared TLS deployment", async () => {
    expect((await proxy(req("GET"))).cookies.get(CLIENT_ID_COOKIE)?.secure).toBe(false);
    process.env.FORCE_HTTPS = "1";
    expect((await proxy(req("GET"))).cookies.get(CLIENT_ID_COOKIE)?.secure).toBe(true);
  });

  it("mints the id on an authenticated pass-through too", async () => {
    process.env.AUTH_PASSWORD = "hunter2";
    const res = await proxy(req("GET", { authorization: basic("analyst", "hunter2") }));
    expect(res.cookies.get(CLIENT_ID_COOKIE)?.value).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not mint an id on a blocked request", async () => {
    expect((await proxy(req("POST", { "sec-fetch-site": "cross-site" }))).cookies.get(CLIENT_ID_COOKIE)).toBeUndefined();
    process.env.AUTH_PASSWORD = "hunter2";
    expect((await proxy(req("GET"))).cookies.get(CLIENT_ID_COOKIE)).toBeUndefined();
  });
});
