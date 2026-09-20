import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST, joinTxtChunks } from "@/app/api/domain-lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie, SUITE_DATA_DIR } from "./testUtils";

// Drives the domain OSINT handler with every free upstream mocked: Cloudflare
// DoH (8 record types incl. SPF/_dmarc TXT + DNSKEY), RDAP whois, Certspotter
// certificate-transparency subdomains, and the Wayback availability API.

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hv-domainroute-"));
  process.env.HV_DATA_DIR = dir;
  process.env.TRUST_PROXY = "1";
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.HV_DATA_DIR = SUITE_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

// A DoH answer set keyed by record type; TXT distinguishes SPF vs _dmarc by name.
// `certspotter` / `crtsh` override the two certificate-transparency sources so a
// test can exercise the sparse-Certspotter → crt.sh fallback and the failure path.
// `dns` overrides one DoH query: return a Response, throw to simulate a network
// failure, or return undefined to keep the default answer.
function stubDomainUpstreams(opts: {
  certspotter?: Response; crtsh?: Response;
  dns?: (name: string, type: string) => Response | undefined;
} = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    const host = u.hostname;

    if (host === "cloudflare-dns.com") {
      const name = u.searchParams.get("name") ?? "";
      const type = u.searchParams.get("type") ?? "";
      const override = opts.dns?.(name, type);
      if (override) return override;
      const answer = (data: string, t = 16) => json({ Answer: [{ name, type: t, TTL: 300, data }] });
      if (type === "A") return answer("104.20.0.1", 1);
      if (type === "AAAA") return answer("2606:4700::1", 28);
      if (type === "MX") return answer("10 mail.acme.test.", 15);
      if (type === "NS") return answer("ns1.acme.test.", 2);
      if (type === "CNAME") return json({ Answer: [] });
      if (type === "DNSKEY") return answer("257 3 13 abc==", 48); // presence ⇒ dnssec
      if (type === "TXT") {
        return name.startsWith("_dmarc.")
          ? answer('"v=DMARC1; p=reject; rua=mailto:dmarc@acme.test"')
          : answer('"v=spf1 include:_spf.acme.test -all"');
      }
      return json({ Answer: [] });
    }

    if (host === "rdap.org") {
      return json({
        events: [
          { eventAction: "registration", eventDate: "2001-05-04T00:00:00Z" },
          { eventAction: "expiration", eventDate: "2030-05-04T00:00:00Z" },
        ],
        entities: [{
          roles: ["registrar"], handle: "123",
          vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Acme Registrar Inc"]]],
        }],
        nameservers: [{ ldhName: "NS1.ACME.TEST" }],
        status: ["client transfer prohibited"],
      });
    }

    if (host === "api.certspotter.com") {
      return opts.certspotter ?? json([
        { dns_names: ["www.acme.test", "api.acme.test"] },
        { dns_names: ["*.acme.test", "acme.test"] }, // wildcard + apex are filtered out
      ]);
    }

    // crt.sh fallback — only fetched when Certspotter comes back sparse (<5).
    // Default set dupes www.* (deduped) and adds blog.* (merged in).
    if (host === "crt.sh") {
      return opts.crtsh ?? json([{ name_value: "www.acme.test\nblog.acme.test" }]);
    }

    // The Wayback replay endpoint 302s to the oldest capture; the timestamp is
    // read out of the Location header, and the body is never consumed.
    if (host === "web.archive.org") {
      return {
        ok: false, status: 302,
        headers: { get: (h: string) => (h.toLowerCase() === "location" ? "http://web.archive.org/web/20040115120000/http://acme.test/" : null) },
        body: null,
        json: async () => ({}),
      } as unknown as Response;
    }

    throw new TypeError("unexpected fetch: " + u.href);
  }));
}

let ipCounter = 0;
const post = (payload: unknown) => {
  const clientIp = `203.0.117.${++ipCounter}`;
  const req = new Request("http://localhost/api/domain-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as unknown as NextRequest);
};

describe("POST /api/domain-lookup: validation", () => {
  it("400 on a malformed body", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 on a value that isn't a domain", async () => {
    const res = await post({ domain: "not a domain!!" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Not a valid domain name");
  });
});

describe("POST /api/domain-lookup: full recon merge", () => {
  it("merges DNS, email posture, DNSSEC, WHOIS, subdomains, and Wayback", async () => {
    stubDomainUpstreams();
    const res = await post({ domain: "acme.test" });
    expect(res.status).toBe(200);
    const j = await res.json();

    expect(j.domain).toBe("acme.test");
    expect(j.dns.a[0].value).toBe("104.20.0.1");
    expect(j.dns.mx[0].value).toBe("mail.acme.test");
    expect(j.dns.mx[0].priority).toBe(10);

    // Email posture parsed from TXT / _dmarc TXT
    expect(j.emailSecurity.hasSpf).toBe(true);
    expect(j.emailSecurity.spf).toContain("v=spf1");
    expect(j.emailSecurity.hasDmarc).toBe(true);
    expect(j.emailSecurity.dmarcPolicy).toBe("reject");
    expect(j.emailSecurity.hasMx).toBe(true);

    expect(j.dnssec).toBe(true); // DNSKEY present

    expect(j.whois.registrar).toBe("Acme Registrar Inc");
    expect(j.whois.createdDate).toBe("2001-05-04T00:00:00Z");
    expect(j.whois.nameservers).toContain("ns1.acme.test");

    // Certspotter (sparse: www + api) is supplemented by the crt.sh fallback
    // (adds blog, dedupes www); apex + wildcard removed throughout.
    expect(j.subdomains.sort()).toEqual(["api.acme.test", "blog.acme.test", "www.acme.test"]);

    expect(j.wayback.available).toBe(true);
    expect(j.wayback.firstSnapshot).toBe("2004-01-15");

    expect(j.pivots.length).toBeGreaterThan(0);
  });

  it("consults crt.sh even when Certspotter answered richly", async () => {
    // It used to stop at five Certspotter hosts. On wordpress.org that window
    // held 9 while crt.sh held 25, so the threshold was never crossed and the
    // tool reported 9 as the answer. Both sources now run on every lookup.
    stubDomainUpstreams({
      certspotter: json([{ dns_names: ["a.acme.test", "b.acme.test", "c.acme.test", "d.acme.test", "e.acme.test"] }]),
      crtsh: json([{ name_value: "crtsh-only.acme.test" }]),
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.subdomains).toContain("crtsh-only.acme.test");
    expect(j.subdomainCoverage.distinct).toBe(6);
  });

  it("degrades to zero subdomains when both certificate-transparency sources fail", async () => {
    stubDomainUpstreams({
      certspotter: json({ error: "rate limited" }, 429),
      crtsh: json("gateway timeout", 504),
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.subdomains).toEqual([]);
  });

  it("flags dangling-CNAME subdomain-takeover candidates (apex + subdomain)", async () => {
    // A DoH stub that returns a CNAME per name: the apex points at S3, one
    // subdomain points at GitHub Pages, the rest resolve to nothing.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.hostname === "cloudflare-dns.com") {
        const name = u.searchParams.get("name") ?? "";
        const type = u.searchParams.get("type") ?? "";
        if (type === "A") return json({ Answer: [{ name, type: 1, TTL: 300, data: "104.20.0.1" }] });
        if (type === "CNAME") {
          // Apex returns the S3 target twice → the second is de-duplicated.
          if (name === "acme.test") return json({ Answer: [
            { name, type: 5, TTL: 300, data: "assets.s3.amazonaws.com" },
            { name, type: 5, TTL: 300, data: "assets.s3.amazonaws.com" },
          ] });
          if (name === "vuln.acme.test") return json({ Answer: [{ name, type: 5, TTL: 300, data: "victim.github.io" }] });
          // A benign CNAME that matches no takeover-prone service.
          if (name === "a.acme.test") return json({ Answer: [{ name, type: 5, TTL: 300, data: "cdn.example.net" }] });
          return json({ Answer: [] });
        }
        return json({ Answer: [] });
      }
      if (u.hostname === "api.certspotter.com") {
        return json([{ dns_names: ["vuln.acme.test", "a.acme.test", "b.acme.test", "c.acme.test", "d.acme.test"] }]);
      }
      if (u.hostname === "rdap.org") return json({}, 404);
      if (u.hostname === "web.archive.org") return json({}, 404);
      throw new TypeError("unexpected fetch: " + u.href);
    }));

    const j = await (await post({ domain: "acme.test" })).json();
    const byName = Object.fromEntries(j.takeoverCandidates.map((c: { name: string; service: string }) => [c.name, c.service]));
    expect(byName["acme.test"]).toBe("AWS S3");
    expect(byName["vuln.acme.test"]).toBe("GitHub Pages");
    expect(j.takeoverCandidates).toHaveLength(2);
    expect(j.takeoverCandidates[0]).toHaveProperty("fingerprint");
  });

  // A service match alone is noise: sweeping github.com on 2026-09-12 matched
  // twelve hosts and every one served real content. Only the provider's
  // "nothing bound here" body makes a candidate a finding.
  it("keeps a candidate whose host serves the unclaimed fingerprint, drops one that serves content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.hostname === "cloudflare-dns.com") {
        const name = u.searchParams.get("name") ?? "";
        const type = u.searchParams.get("type") ?? "";
        if (type === "A") return json({ Answer: [{ name, type: 1, TTL: 300, data: "104.20.0.1" }] });
        if (type === "CNAME") {
          if (name === "gone.acme.test") return json({ Answer: [{ name, type: 5, TTL: 300, data: "gone.github.io" }] });
          if (name === "live.acme.test") return json({ Answer: [{ name, type: 5, TTL: 300, data: "live.github.io" }] });
          return json({ Answer: [] });
        }
        return json({ Answer: [] });
      }
      if (u.hostname === "api.certspotter.com") return json([{ dns_names: ["gone.acme.test", "live.acme.test"] }]);
      if (u.hostname === "rdap.org") return json({}, 404);
      if (u.hostname === "web.archive.org") return json({}, 404);
      // The verification probes themselves.
      if (u.hostname === "gone.acme.test") {
        return new Response("<h1>There isn't a GitHub Pages site here.</h1>", { status: 404 });
      }
      if (u.hostname === "live.acme.test") {
        return new Response("<html><body>Real docs site</body></html>", { status: 200 });
      }
      throw new TypeError("unexpected fetch: " + u.href);
    }));

    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.takeoverCandidates).toHaveLength(1);
    expect(j.takeoverCandidates[0].name).toBe("gone.acme.test");
    expect(j.takeoverCandidates[0].verification).toBe("unclaimed");
  });

  it("never follows a candidate's redirect into the metadata service", async () => {
    // The check used redirect: "follow", so a hostile subdomain could bounce it
    // anywhere, IP literals included, and the body decided the verdict.
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      seen.push(u.href);
      if (u.hostname === "cloudflare-dns.com") {
        const name = u.searchParams.get("name") ?? "";
        const type = u.searchParams.get("type") ?? "";
        if (type === "A") return json({ Answer: [{ name, type: 1, TTL: 300, data: "104.20.0.1" }] });
        if (type === "CNAME" && name === "gone.acme.test") {
          return json({ Answer: [{ name, type: 5, TTL: 300, data: "gone.github.io" }] });
        }
        return json({ Answer: [] });
      }
      if (u.hostname === "api.certspotter.com") return json([{ dns_names: ["gone.acme.test"] }]);
      if (u.hostname === "rdap.org") return json({}, 404);
      if (u.hostname === "web.archive.org") return json({}, 404);
      if (u.hostname === "gone.acme.test") {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      return new Response("<h1>There isn't a GitHub Pages site here.</h1>", { status: 404 });
    }));

    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.takeoverCandidates).toHaveLength(1);
    expect(j.takeoverCandidates[0].verification).toBe("unverified");
    expect(seen.some((href) => href.includes("169.254.169.254"))).toBe(false);
  });

  it("leaves a candidate unverified when its host resolves nowhere probeable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.hostname === "cloudflare-dns.com") {
        const name = u.searchParams.get("name") ?? "";
        const type = u.searchParams.get("type") ?? "";
        // No A record at all → nothing to probe, so nothing is claimed either.
        if (type === "CNAME" && name === "gone.acme.test") {
          return json({ Answer: [{ name, type: 5, TTL: 300, data: "gone.github.io" }] });
        }
        return json({ Answer: [] });
      }
      if (u.hostname === "api.certspotter.com") return json([{ dns_names: ["gone.acme.test"] }]);
      if (u.hostname === "rdap.org") return json({}, 404);
      if (u.hostname === "web.archive.org") return json({}, 404);
      throw new TypeError("unexpected fetch: " + u.href);
    }));

    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.takeoverCandidates).toHaveLength(1);
    expect(j.takeoverCandidates[0].verification).toBe("unverified");
  });

  it("returns no takeover candidates when nothing dangles", async () => {
    stubDomainUpstreams();
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.takeoverCandidates).toEqual([]);
  });

  it("normalizes a full URL (scheme/path/www) down to the bare domain", async () => {
    stubDomainUpstreams();
    const res = await post({ domain: "https://www.ACME.test/some/path?x=1" });
    expect(res.status).toBe(200);
    expect((await res.json()).domain).toBe("acme.test");
  });
});

// ── An unanswered DNS query is unknown, never absent ─────────────────────────
// The DoH helper used to return [] for a timeout, a non-2xx and a SERVFAIL
// alike, so one failed TXT query called a real domain spoofable.
describe("POST /api/domain-lookup: DNS answers vs. failures", () => {
  type Health = { source: string; ok: boolean; error?: string };
  const dnsHealth = (j: { sourceHealth: Health[] }) => j.sourceHealth.find((h) => h.source === "dns")!;
  const timeout = () => { throw new DOMException("t", "TimeoutError"); };

  it("leaves SPF unknown when the TXT query times out, and names the query", async () => {
    stubDomainUpstreams({ dns: (name, type) => (type === "TXT" && !name.startsWith("_dmarc.") ? timeout() : undefined) });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.emailSecurity.hasSpf).toBeNull();
    expect(j.emailSecurity.spf).toBeNull();
    expect(j.emailSecurity.hasDmarc).toBe(true); // its own query answered
    expect(j.emailSecurity.hasMx).toBe(true);
    expect(j.dns.txt).toEqual([]);
    expect(j.dnsFailed).toEqual(["TXT"]);
    expect(dnsHealth(j)).toMatchObject({ ok: false, error: "no answer for TXT" });
  });

  it("treats SERVFAIL, REFUSED and a non-2xx as no answer, not as no records", async () => {
    stubDomainUpstreams({
      dns: (name, type) =>
        type === "MX" ? json({ Status: 2 })               // SERVFAIL arrives as HTTP 200
        : name.startsWith("_dmarc.") ? json({}, 503)
        : type === "DNSKEY" ? json({ Status: 5 })         // REFUSED
        : undefined,
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.emailSecurity).toMatchObject({ hasSpf: true, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: null });
    expect(j.dnssec).toBeNull();
    expect(j.dnsFailed).toEqual(["MX", "DMARC", "DNSKEY"]);
    expect(dnsHealth(j).error).toBe("no answer for MX, DMARC, DNSKEY");
  });

  it("reports every posture as unknown when no query is answered", async () => {
    stubDomainUpstreams({ dns: timeout });
    const res = await post({ domain: "acme.test" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dns).toEqual({ a: [], aaaa: [], mx: [], txt: [], ns: [], cname: [] });
    expect(j.emailSecurity).toEqual({ hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: null });
    expect(j.dnssec).toBeNull();
    expect(j.dnsFailed).toEqual(["A", "AAAA", "MX", "TXT", "NS", "CNAME", "DMARC", "DNSKEY"]);
    expect(j.takeoverCandidates).toEqual([]);
  });

  it("treats NXDOMAIN as a definitive answer: no records, and a healthy source", async () => {
    stubDomainUpstreams({ dns: () => json({ Status: 3 }) });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.emailSecurity).toEqual({ hasSpf: false, spf: null, hasDmarc: false, dmarcPolicy: null, hasMx: false, nullMx: false });
    expect(j.dnssec).toBe(false);
    expect(j.dnsFailed).toEqual([]);
    const h = dnsHealth(j);
    expect(h.ok).toBe(true);
    expect(h.error).toBeUndefined();
  });

  it("reports no failures when every query answers", async () => {
    stubDomainUpstreams({ dns: (_n, type) => (type === "NS" ? json({ Status: 0, Answer: [] }) : undefined) });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.dnsFailed).toEqual([]);
    expect(j.dns.ns).toEqual([]);
    expect(dnsHealth(j).ok).toBe(true);
  });
});

// RFC 7505: `0 .` is a domain stating in DNS that it accepts no mail.
// example.com publishes exactly that, and the tool read it as a mail server:
// the trailing-dot strip every other record type needs turned the root label
// into "", so the panel drew a blank MX row, the report dropped the field, and
// the email-security card said "Receives mail" about a domain that refuses it.
describe("POST /api/domain-lookup: the RFC 7505 null MX", () => {
  const nullMx = (name: string, type: string) =>
    type === "MX" ? json({ Answer: [{ name, type: 15, TTL: 300, data: "0 ." }] }) : undefined;

  it("reads a null MX as a refusal, not as a mail server", async () => {
    stubDomainUpstreams({ dns: nullMx });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.dns.mx).toEqual([{ type: "MX", value: ".", ttl: 300, priority: 0 }]);
    expect(j.emailSecurity.hasMx).toBe(false);
    expect(j.emailSecurity.nullMx).toBe(true);
  });

  it("keeps a preference of 0 on an ordinary exchanger", async () => {
    stubDomainUpstreams({
      dns: (name, type) =>
        type === "MX" ? json({ Answer: [{ name, type: 15, TTL: 300, data: "0 mail.acme.test." }] }) : undefined,
    });
    const j = await (await post({ domain: "acme.test" })).json();
    // `parseInt(prio) || undefined` dropped it, because 0 is falsy.
    expect(j.dns.mx).toEqual([{ type: "MX", value: "mail.acme.test", ttl: 300, priority: 0 }]);
    expect(j.emailSecurity.hasMx).toBe(true);
    expect(j.emailSecurity.nullMx).toBe(false);
  });

  it("does not read a root label beside a real exchanger as a refusal", async () => {
    // RFC 7505 requires the null MX to stand alone. A set that also names a
    // real host is a misconfiguration, and mail still lands there.
    stubDomainUpstreams({
      dns: (name, type) =>
        type === "MX"
          ? json({ Answer: [
              { name, type: 15, TTL: 300, data: "0 ." },
              { name, type: 15, TTL: 300, data: "10 mail.acme.test." },
            ] })
          : undefined,
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.emailSecurity.nullMx).toBe(false);
    expect(j.emailSecurity.hasMx).toBe(true);
  });

  it("drops a preference that is not a number rather than inventing one", async () => {
    stubDomainUpstreams({
      dns: (name, type) =>
        type === "MX" ? json({ Answer: [{ name, type: 15, TTL: 300, data: "mail.acme.test." }] }) : undefined,
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.dns.mx).toEqual([{ type: "MX", value: "", ttl: 300 }]);
  });
});

describe("POST /api/domain-lookup: rate limiting", () => {
  afterEach(restoreRateLimit);

  it("allows MAX requests then 429s the next from the same client", async () => {
    useRateLimit(10);
    stubDomainUpstreams();
    const req = () => new Request("http://localhost/api/domain-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: clientCookie("rlclient") },
      body: JSON.stringify({ domain: "acme.test" }),
    });
    let last = await POST(req() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(req() as unknown as NextRequest);
    expect(last.status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});

// ── TXT reassembly (RFC 1035 §3.3.14) ────────────────────────────────────────
// A TXT record is one or more character-strings, each capped at 255 bytes, and
// the value is their concatenation. DoH renders that as adjacent quoted runs.
// Stripping only the outer quotes left the join visible mid-value, so
// github.com's SPF read `ip4:62.253.2" "27.114` for what is really
// `ip4:62.253.227.114` — an analyst copying that netblock got an address that
// does not exist.
describe("joinTxtChunks", () => {
  it("concatenates the character-strings of a split record", () => {
    expect(joinTxtChunks('"v=spf1 a ip4:62.253.2" "27.114 ~all"'))
      .toBe("v=spf1 a ip4:62.253.227.114 ~all");
  });

  it("unwraps a single-chunk record", () => {
    expect(joinTxtChunks('"v=spf1 -all"')).toBe("v=spf1 -all");
  });

  it("passes through a value that carries no quoted runs", () => {
    // Some resolvers hand back the bare string; it is already the value.
    expect(joinTxtChunks("v=spf1 -all")).toBe("v=spf1 -all");
  });

  it("unescapes an escaped quote inside a chunk", () => {
    expect(joinTxtChunks('"say \\"hi\\""')).toBe('say "hi"');
  });
});
