import { describe, it, expect } from "vitest";
import {
  buildUsernameReport, buildIpReport, buildDomainReport,
  reportToText, reportToMarkdown, reportToHtml, reportToStixBundle, detUuid,
  type ReportModel,
} from "@/lib/analysis/report";
import type { UsernameLookupResponse, IpLookupResponse, DomainLookupResponse } from "@/lib/types";

// ── Builders ─────────────────────────────────────────────────────────────────

describe("buildUsernameReport", () => {
  it("builds a full model from a rich username response", () => {
    const data = {
      username: "torvalds", checked: 30, found: 2, manual: 4,
      hits: [
        { site: "GitHub", category: "dev", url: "https://github.com/torvalds", status: "found" },
        { site: "Nope", category: "dev", url: "x", status: "notfound" },
      ],
      profiles: [
        { platform: "GitHub", category: "dev", handle: "torvalds", url: "https://github.com/torvalds", avatarUrl: null, displayName: "Linus", bio: null, stats: [], joinedYear: "2011", location: "Portland", extra: null },
        // A sparse profile: no display name / location / joined year → the `bits`
        // filter drops those and the joinedYear ternary takes its null branch.
        { platform: "Reddit", category: "dev", handle: "t", url: "https://reddit.com/u/t", avatarUrl: null, displayName: null, bio: null, stats: [], joinedYear: null, location: null, extra: null },
      ],
      identity: { names: [{ value: "Linus Torvalds", source: "GitHub" }], locations: [], avatars: [], bios: [] },
      pivots: [{ label: "Google", url: "https://g.co" }],
      leakCheck: { ok: false }, hudsonRock: { ok: false },
      sourceHealth: [{ source: "usernameSweep", ok: true, ms: 100, fetchedAt: 0 }],
    } as unknown as UsernameLookupResponse;

    const m = buildUsernameReport(data);
    expect(m.kind).toBe("username");
    expect(m.subject).toBe("torvalds");
    expect(m.headline).toEqual({ label: "Confirmed accounts", value: "2 of 30" });
    expect(m.sections.find((s) => s.heading === "Confirmed accounts")?.list).toEqual(["GitHub: https://github.com/torvalds"]);
    expect(m.sections.find((s) => s.heading === "Verified profiles")?.list?.[0]).toContain("Linus");
    expect(m.sections.find((s) => s.heading === "Identity signals: names")?.list).toEqual(["Linus Torvalds (GitHub)"]);
    expect(m.sections[0].rows).toContainEqual({ label: "Open-to-verify sites", value: "4" });
    expect(m.observables).toEqual([{ type: "user-account", value: "torvalds" }]);
  });

  it("omits empty sections and the manual row when sparse", () => {
    const data = {
      username: "ghost", checked: 5, found: 0, manual: 0,
      hits: [], profiles: [], identity: { names: [], locations: [], avatars: [], bios: [] },
      pivots: [], leakCheck: { ok: false }, hudsonRock: { ok: false },
    } as unknown as UsernameLookupResponse;
    const m = buildUsernameReport(data);
    expect(m.sections.map((s) => s.heading)).toEqual(["Summary"]);
    expect(m.sections[0].rows?.some((r) => r.label === "Open-to-verify sites")).toBe(false);
    expect(m.sources).toEqual([]); // no sourceHealth
  });
});

describe("buildIpReport", () => {
  it("builds geo, network, flags, ports and CVEs from a full IP response", () => {
    const data = {
      input: "8.8.8.8",
      ip: {
        ip: "8.8.8.8", type: "IPv4", city: "Mountain View", region: "CA", country: "United States", countryCode: "US",
        continent: "NA", latitude: 37.4, longitude: -122, postal: null, timezone: "America/Los_Angeles", utcOffset: "-08:00",
        asn: 15169, asnOrg: "Google LLC", isp: "Google", org: null, isProxy: false, isVpn: false, isTor: null, isHosting: true, isMobile: false,
        flagEmoji: "🇺🇸", reverse: "dns.google", ports: [53, 443], vulns: ["CVE-1"], hostnames: null, tags: null, greyNoise: null,
        abuseContact: "abuse@google.com", prefix: "8.8.8.0/24", announcedPrefixes: 42,
      },
      pivots: [{ label: "Shodan", url: "https://shodan.io", note: "x" }],
      threatScore: 65, threatLabel: "MODERATE",
      sourceHealth: [{ source: "ip-api.com", ok: true, ms: 20, fetchedAt: 0 }],
    } as unknown as IpLookupResponse;

    const m = buildIpReport(data);
    expect(m.headline).toEqual({ label: "Threat", value: "65/100: MODERATE" });
    const net = m.sections.find((s) => s.heading === "Network / ASN")!;
    expect(net.rows).toContainEqual({ label: "Abuse contact", value: "abuse@google.com" });
    expect(net.rows).toContainEqual({ label: "ASN prefixes", value: "42" });
    expect(m.sections.find((s) => s.heading === "Risk flags")?.rows).toContainEqual({ label: "Hosting", value: "Yes" });
    expect(m.sections.find((s) => s.heading === "Open ports")?.list).toEqual(["53", "443"]);
    expect(m.observables).toEqual([{ type: "ipv4-addr", value: "8.8.8.8" }]);
  });

  it("handles a null IP (no data) and an IPv6 observable", () => {
    const noData = { input: "1.1.1.1", ip: null, pivots: [], threatScore: 0, threatLabel: "UNKNOWN", sources: [{ source: "ip-api.com", ok: false, ms: 1, fetchedAt: 0 }] } as unknown as IpLookupResponse;
    const m = buildIpReport(noData);
    expect(m.sections).toEqual([]);
    expect(m.observables).toEqual([{ type: "ipv4-addr", value: "1.1.1.1" }]);
    expect(m.sources).toHaveLength(1); // fell back to data.sources

    const v6 = { input: "2606:4700::1", ip: { type: "IPv6", asn: null, ports: null, vulns: null, isVpn: null, isHosting: null, isTor: null, isMobile: null } as unknown, pivots: [], threatScore: 0, threatLabel: "CLEAN" } as unknown as IpLookupResponse;
    expect(buildIpReport(v6).observables).toEqual([{ type: "ipv6-addr", value: "2606:4700::1" }]);
    // No risk-flag section when every flag is null
    expect(buildIpReport(v6).sections.some((s) => s.heading === "Risk flags")).toBe(false);
  });
});

describe("buildDomainReport", () => {
  const base = {
    domain: "acme.test", isValid: true,
    dns: { a: [{ type: "A", value: "1.2.3.4" }], aaaa: [{ type: "AAAA", value: "2606:4700::1" }], mx: [{ type: "MX", value: "mail.acme.test" }], txt: [], ns: [{ type: "NS", value: "ns1.acme.test" }], cname: [] },
    emailSecurity: { hasSpf: true, spf: "v=spf1", hasDmarc: true, dmarcPolicy: "reject", hasMx: true },
    subdomains: [], pivots: [{ label: "crt.sh", url: "https://crt.sh", note: "x" }], dnssec: true, wayback: null, http: null,
  };

  it("builds DNS, email security, WHOIS, subdomains and takeover sections", () => {
    const data = {
      ...base, whois: { registrar: "R Inc", createdDate: "2001-01-01", updatedDate: null, expiresDate: "2030-01-01", nameservers: [], statuses: [], registrantOrg: "Acme", registrantCountry: null },
      subdomains: ["www.acme.test", "api.acme.test"],
      takeoverCandidates: [{ name: "vuln.acme.test", host: "x.github.io", service: "GitHub Pages", status: "edge-case", fingerprint: "fp", reference: "ref" }],
      http: { url: "https://acme.test", status: 200, redirectChain: [], httpsRedirect: true, security: { checks: [], score: 8, max: 10, percent: 80, grade: "B" }, tech: [], disclosures: [], cookies: [], title: null, tls: null },
      sourceHealth: [{ source: "dns", ok: true, ms: 30, fetchedAt: 0 }],
    } as unknown as DomainLookupResponse;

    const m = buildDomainReport(data);
    expect(m.headline).toEqual({ label: "HTTP headers", value: "grade B" });
    expect(m.sections.find((s) => s.heading === "DNS")?.rows).toContainEqual({ label: "A", value: "1.2.3.4" });
    expect(m.sections.find((s) => s.heading === "WHOIS")?.rows).toContainEqual({ label: "Registrar", value: "R Inc" });
    expect(m.sections.find((s) => s.heading === "Subdomains (2)")?.list).toHaveLength(2);
    expect(m.sections.find((s) => s.heading === "Subdomain-takeover candidates")?.list?.[0]).toContain("GitHub Pages");
    expect(m.observables).toEqual([{ type: "domain-name", value: "acme.test" }, { type: "ipv4-addr", value: "1.2.3.4" }]);
  });

  it("renders a missing email posture and a policy-less DMARC", () => {
    const missing = buildDomainReport({ ...base, whois: null, emailSecurity: { hasSpf: false, spf: null, hasDmarc: false, dmarcPolicy: null, hasMx: false } } as unknown as DomainLookupResponse);
    const rows = missing.sections.find((s) => s.heading === "Email security")!.rows!;
    expect(rows).toContainEqual({ label: "SPF", value: "missing" });
    expect(rows).toContainEqual({ label: "DMARC", value: "missing" });
    expect(rows).toContainEqual({ label: "MX", value: "no" });

    const setPolicy = buildDomainReport({ ...base, whois: null, emailSecurity: { hasSpf: true, spf: "x", hasDmarc: true, dmarcPolicy: null, hasMx: true } } as unknown as DomainLookupResponse);
    expect(setPolicy.sections.find((s) => s.heading === "Email security")!.rows).toContainEqual({ label: "DMARC", value: "set" });
  });

  it("omits WHOIS/subdomains/takeover/http when absent", () => {
    const data = { ...base, whois: null } as unknown as DomainLookupResponse;
    const m = buildDomainReport(data);
    expect(m.headline).toBeUndefined();
    expect(m.sections.map((s) => s.heading)).toEqual(["DNS", "Email security"]);
    expect(m.sources).toEqual([]);
  });
});

// ── Renderers ─────────────────────────────────────────────────────────────────

const model: ReportModel = {
  kind: "domain", subject: "acme.test", generatedAt: "2026-09-02T00:00:00.000Z",
  headline: { label: "HTTP headers", value: "grade B" },
  sections: [
    { heading: "DNS", rows: [{ label: "A", value: "1.2.3.4" }, { label: "MX", value: "a | b" }] },
    { heading: "Subdomains (1)", list: ["www.acme.test"] },
  ],
  sources: [{ source: "dns", ok: true, ms: 30 }, { source: "whois", ok: false }],
  pivots: [{ label: "crt.sh", url: "https://crt.sh" }],
  observables: [{ type: "domain-name", value: "acme.test" }, { type: "user-account", value: "acme" }],
};

const noHeadline: ReportModel = { ...model, headline: undefined, sources: [], pivots: [] };

describe("reportToText", () => {
  it("renders headline, sections, sources and pivots", () => {
    const t = reportToText(model);
    expect(t).toContain("DOMAIN intelligence report");
    expect(t).toContain("HTTP headers : grade B");
    expect(t).toContain("• www.acme.test");
    expect(t).toContain("OK  dns · 30ms");
    expect(t).toContain("ERR whois");
    expect(t).toContain("crt.sh: https://crt.sh");
  });
  it("skips headline/sources/pivots blocks when empty", () => {
    const t = reportToText(noHeadline);
    expect(t).not.toContain("HTTP headers");
    expect(t).not.toContain("DATA SOURCES");
    expect(t).not.toContain("PIVOTS");
  });
});

describe("reportToMarkdown", () => {
  it("renders a table, list and escapes pipes", () => {
    const md = reportToMarkdown(model);
    expect(md).toContain("# HEAVEN-GeoIntel: domain report: acme.test");
    expect(md).toContain("| Field | Value |");
    expect(md).toContain("| MX | a \\| b |"); // pipe escaped
    expect(md).toContain("- www.acme.test");
    expect(md).toContain("- ✅ dns (30ms)");
    expect(md).toContain("- ❌ whois");
  });
  it("escapes a backslash before the pipe so a cell can't reopen a delimiter", () => {
    // Input value: a \ | b  (backslash then pipe). A pipe-only escape would emit
    // "a \\| b", where "\\" is an escaped backslash and "|" is a live delimiter.
    const m: ReportModel = { ...model, sections: [{ heading: "X", rows: [{ label: "L", value: "a\\|b" }] }] };
    const md = reportToMarkdown(m);
    // backslash → "\\", pipe → "\|"  ⇒  a + \\ + \| + b
    expect(md).toContain("| L | a\\\\\\|b |");
  });
  it("omits the headline and sources when absent", () => {
    const md = reportToMarkdown(noHeadline);
    expect(md).not.toContain("HTTP headers");
    expect(md).not.toContain("## Data sources");
  });
});

describe("reportToHtml", () => {
  it("renders a printable page with tables, lists and escaping", () => {
    const html = reportToHtml({ ...model, sections: [{ heading: "DNS", rows: [{ label: "A", value: "<b>1.2.3.4</b>" }] }, { heading: "Subs", list: ["a&b"] }] });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<th>A</th><td>&lt;b&gt;1.2.3.4&lt;/b&gt;</td>");
    expect(html).toContain("<li>a&amp;b</li>");
    expect(html).toContain("@page");
  });
  it("drops the headline clause when absent", () => {
    expect(reportToHtml(noHeadline)).not.toContain("HTTP headers");
  });
});

describe("detUuid + reportToStixBundle", () => {
  it("detUuid is deterministic and UUID-shaped", () => {
    expect(detUuid("x")).toBe(detUuid("x"));
    expect(detUuid("x")).not.toBe(detUuid("y"));
    expect(detUuid("acme.test")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("emits a valid STIX 2.1 bundle with identity, SCOs and a report", () => {
    const bundle = reportToStixBundle(model) as { type: string; objects: Array<Record<string, unknown>> };
    expect(bundle.type).toBe("bundle");
    const types = bundle.objects.map((o) => o.type);
    expect(types).toEqual(["identity", "domain-name", "user-account", "report"]);
    const domain = bundle.objects.find((o) => o.type === "domain-name")!;
    expect(domain.value).toBe("acme.test");
    const account = bundle.objects.find((o) => o.type === "user-account")!;
    expect(account.account_login).toBe("acme"); // user-account uses account_login, not value
    expect(account.value).toBeUndefined();
    const report = bundle.objects.find((o) => o.type === "report") as { object_refs: string[]; created_by_ref: string };
    expect(report.object_refs).toHaveLength(2);
    expect(report.created_by_ref).toContain("identity--");
  });
});
