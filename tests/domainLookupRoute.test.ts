import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST, joinTxtChunks } from "@/app/api/domain-lookup/route";
import { useRateLimit, restoreRateLimit, clientCookie } from "./testUtils";

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
  delete process.env.HV_DATA_DIR;
  delete process.env.TRUST_PROXY;
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

// A DoH answer set keyed by record type; TXT distinguishes SPF vs _dmarc by name.
// `certspotter` / `crtsh` override the two certificate-transparency sources so a
// test can exercise the sparse-Certspotter → crt.sh fallback and the failure path.
function stubDomainUpstreams(opts: { certspotter?: Response; crtsh?: Response } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    const host = u.hostname;

    if (host === "cloudflare-dns.com") {
      const name = u.searchParams.get("name") ?? "";
      const type = u.searchParams.get("type") ?? "";
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

    if (host === "archive.org") {
      return json({
        archived_snapshots: {
          closest: { timestamp: "20040115120000", url: "http://web.archive.org/web/20040115120000/http://acme.test/" },
        },
      });
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

  it("skips the crt.sh fallback when Certspotter already returns enough subdomains", async () => {
    // 5 Certspotter subdomains ⇒ at the threshold ⇒ crt.sh is never consulted, so
    // its sentinel host must not appear in the merged result.
    stubDomainUpstreams({
      certspotter: json([{ dns_names: ["a.acme.test", "b.acme.test", "c.acme.test", "d.acme.test", "e.acme.test"] }]),
      crtsh: json([{ name_value: "crtsh-only.acme.test" }]),
    });
    const j = await (await post({ domain: "acme.test" })).json();
    expect(j.subdomains).toEqual(["a.acme.test", "b.acme.test", "c.acme.test", "d.acme.test", "e.acme.test"]);
    expect(j.subdomains).not.toContain("crtsh-only.acme.test");
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
      if (u.hostname === "archive.org") return json({ archived_snapshots: {} });
      throw new TypeError("unexpected fetch: " + u.href);
    }));

    const j = await (await post({ domain: "acme.test" })).json();
    const byName = Object.fromEntries(j.takeoverCandidates.map((c: { name: string; service: string }) => [c.name, c.service]));
    expect(byName["acme.test"]).toBe("AWS S3");
    expect(byName["vuln.acme.test"]).toBe("GitHub Pages");
    expect(j.takeoverCandidates).toHaveLength(2);
    expect(j.takeoverCandidates[0]).toHaveProperty("fingerprint");
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
