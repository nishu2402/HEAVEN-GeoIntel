import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/domain-lookup/route";

// Drives the domain OSINT handler with every free upstream mocked: Cloudflare
// DoH (8 record types incl. SPF/_dmarc TXT + DNSKEY), RDAP whois, crt.sh
// subdomains, and the Wayback CDX API.

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
function stubDomainUpstreams() {
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

    if (host === "crt.sh") {
      return json([
        { name_value: "www.acme.test\napi.acme.test" },
        { name_value: "*.acme.test" }, // wildcard + apex are filtered out
      ]);
    }

    if (host === "web.archive.org") {
      return json([["timestamp", "original"], ["20040115120000", "http://acme.test/"]]);
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

describe("POST /api/domain-lookup — validation", () => {
  it("400 on a malformed body", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 on a value that isn't a domain", async () => {
    const res = await post({ domain: "not a domain!!" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Not a valid domain name");
  });
});

describe("POST /api/domain-lookup — full recon merge", () => {
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

    // Only real subdomains (apex + wildcard removed)
    expect(j.subdomains.sort()).toEqual(["api.acme.test", "www.acme.test"]);

    expect(j.wayback.available).toBe(true);
    expect(j.wayback.firstSnapshot).toBe("2004-01-15");

    expect(j.pivots.length).toBeGreaterThan(0);
  });

  it("normalizes a full URL (scheme/path/www) down to the bare domain", async () => {
    stubDomainUpstreams();
    const res = await post({ domain: "https://www.ACME.test/some/path?x=1" });
    expect(res.status).toBe(200);
    expect((await res.json()).domain).toBe("acme.test");
  });
});

describe("POST /api/domain-lookup — rate limiting", () => {
  it("429s the 11th request from one client IP", async () => {
    stubDomainUpstreams();
    const req = () => new Request("http://localhost/api/domain-lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.123" },
      body: JSON.stringify({ domain: "acme.test" }),
    });
    let last = await POST(req() as unknown as NextRequest);
    for (let i = 0; i < 9; i++) last = await POST(req() as unknown as NextRequest);
    expect(last.status).toBe(200);
    expect((await POST(req() as unknown as NextRequest)).status).toBe(429);
  });
});
