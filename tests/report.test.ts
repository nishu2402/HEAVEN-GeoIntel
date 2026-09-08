import { describe, it, expect } from "vitest";
import {
  buildPhoneReport, buildEmailReport, buildUsernameReport, buildIpReport,
  buildDomainReport, buildWalletReport, buildHashReport,
  reportToText, reportToMarkdown, reportToHtml, reportToStixBundle, detUuid,
  type ReportModel,
} from "@/lib/analysis/report";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse,
  DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
} from "@/lib/types";

// ── Builders ─────────────────────────────────────────────────────────────────

describe("buildPhoneReport", () => {
  it("builds number, geo and risk sections plus a grounded assessment", () => {
    const data = {
      input: { e164: "+14155552671", isValid: true, countryCallingCode: "1" },
      analysis: { e164: "+14155552671" },
      offline: { confidence: "medium" },
      aggregated: {
        formatInternational: "+1 415-555-2671", formatNational: "(415) 555-2671",
        countryName: "United States", country: "US", region: "California", city: "San Francisco",
        timezone: ["America/Los_Angeles"], lineType: "mobile", carrier: "Verizon", prepaid: false,
        fraudScore: 12, isRisky: false, recentAbuse: false, isVoip: false, isDisposable: false,
      },
      threatScore: 12, threatLabel: "LOW RISK",
      sourceHealth: [{ source: "libphonenumber", ok: true, ms: 1, fetchedAt: 0 }],
    } as unknown as LookupResponse;

    const m = buildPhoneReport(data);
    expect(m.kind).toBe("phone");
    expect(m.subject).toBe("+14155552671");
    expect(m.headline).toEqual({ label: "Threat", value: "12/100: LOW RISK" });
    expect(m.sections.find((s) => s.heading === "Number")?.rows).toContainEqual({ label: "Carrier", value: "Verizon" });
    expect(m.sections.find((s) => s.heading === "Geolocation")?.rows).toContainEqual({ label: "Country", value: "United States (US)" });
    expect(m.sections.find((s) => s.heading === "Risk signals")?.rows).toContainEqual({ label: "Fraud score", value: "12/100" });
    expect(m.summary).toContainEqual({ label: "Number", value: "+14155552671" });
    expect(m.assessment?.narrative.length).toBeGreaterThan(0);
    expect(m.observables).toEqual([]);
  });

  it("omits empty sections when the number is bare", () => {
    const data = {
      input: { e164: "+9999999", isValid: false, countryCallingCode: "" },
      analysis: { e164: "+9999999" },
      offline: { confidence: "low" },
      aggregated: {
        formatInternational: null, formatNational: null, countryName: null, country: null,
        region: null, city: null, timezone: null, lineType: null, carrier: null, prepaid: null,
        fraudScore: null, isRisky: null, recentAbuse: null, isVoip: null, isDisposable: null,
      },
      threatScore: 0, threatLabel: "UNKNOWN",
    } as unknown as LookupResponse;
    const m = buildPhoneReport(data);
    // Only the Number section survives; geo and risk collapse to nothing.
    expect(m.sections.map((s) => s.heading)).toEqual(["Number"]);
    expect(m.sources).toEqual([]);
  });
});

describe("buildEmailReport", () => {
  it("builds classification, reputation, breach and profile sections", () => {
    const data = {
      email: "target@example.com",
      analysis: { providerName: "Custom Corporate", providerType: "corporate", isDisposable: false, isRoleAddress: false, isWebmail: false, isPrivacyFocused: false },
      gravatar: { found: true, displayName: "Target", currentLocation: "NYC", profileUrl: "https://gravatar.com/x", accounts: [{ shortname: "gh", username: "t", url: "u" }] },
      emailrep: { ok: true, data: { reputation: "high", suspicious: false, blacklisted: false, maliciousActivity: false, credentialsLeaked: true, deliverable: true, spoofable: false } },
      breachAggregate: { total: 3, withPassword: 2, sourcesReporting: ["XposedOrNot"], dataClasses: ["Emails", "Passwords"] },
      sourceHealth: [{ source: "xon", ok: true, ms: 5, fetchedAt: 0 }],
    } as unknown as EmailLookupResponse;

    const m = buildEmailReport(data);
    expect(m.kind).toBe("email");
    expect(m.subject).toBe("target@example.com");
    expect(m.headline?.label).toBe("Risk");
    expect(m.sections.find((s) => s.heading === "Classification")?.rows).toContainEqual({ label: "Provider", value: "Custom Corporate" });
    expect(m.sections.find((s) => s.heading === "Reputation")?.rows).toContainEqual({ label: "Credentials leaked", value: "Yes" });
    expect(m.sections.find((s) => s.heading === "Breach exposure")?.rows).toContainEqual({ label: "Breaches", value: "3" });
    expect(m.sections.find((s) => s.heading === "Gravatar profile")?.rows).toContainEqual({ label: "Display name", value: "Target" });
    expect(m.observables).toEqual([{ type: "email-addr", value: "target@example.com" }]);
  });

  it("omits reputation, breach and profile blocks when absent", () => {
    const data = {
      email: "x@y.z",
      analysis: { providerName: "Unknown", providerType: "unknown", isDisposable: null, isRoleAddress: null, isWebmail: null, isPrivacyFocused: null },
      gravatar: { found: false, displayName: null, currentLocation: null, profileUrl: null, accounts: [] },
      emailrep: { ok: false, error: "NOT_CONFIGURED" },
    } as unknown as EmailLookupResponse;
    const m = buildEmailReport(data);
    expect(m.sections.map((s) => s.heading)).toEqual(["Classification"]);
    expect(m.sources).toEqual([]);
  });

  it("keeps only the breach count when passwords, sources and data classes are empty", () => {
    const data = {
      email: "z@z.z",
      analysis: { providerName: "Gmail", providerType: "free", isDisposable: false, isRoleAddress: false, isWebmail: true, isPrivacyFocused: false },
      gravatar: { found: false, displayName: null, currentLocation: null, profileUrl: null, accounts: [] },
      emailrep: { ok: false, error: "x" },
      breachAggregate: { total: 1, withPassword: 0, sourcesReporting: [], dataClasses: [] },
    } as unknown as EmailLookupResponse;
    const rows = buildEmailReport(data).sections.find((s) => s.heading === "Breach exposure")?.rows;
    expect(rows).toEqual([{ label: "Breaches", value: "1" }]);
  });
});

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
    // The grounded AI assessment rides along, tracing back to the same fields.
    expect(m.assessment?.narrative.length).toBeGreaterThan(0);
    expect(m.assessment?.narrative.join(" ")).toContain("8.8.8.8");
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

describe("buildWalletReport", () => {
  it("builds on-chain and ENS sections from a resolved wallet", () => {
    const data = {
      input: "0xabc", chain: "eth",
      facts: { chain: "eth", address: "0xabc", balance: "1.5 ETH", balanceRaw: "1500000000000000000", txCount: 42, totalReceived: null, totalSent: null },
      ens: { name: "vitalik.eth", address: "0xabc", verified: true },
      pivots: [{ label: "Etherscan", url: "https://etherscan.io", note: "x" }],
      sourceHealth: [{ source: "rpc", ok: true, ms: 9, fetchedAt: 0 }],
    } as unknown as WalletLookupResponse;

    const m = buildWalletReport(data);
    expect(m.kind).toBe("wallet");
    expect(m.headline).toEqual({ label: "Balance", value: "1.5 ETH" });
    expect(m.sections.find((s) => s.heading === "On-chain")?.rows).toContainEqual({ label: "Transactions", value: "42" });
    expect(m.sections.find((s) => s.heading === "ENS identity")?.rows).toContainEqual({ label: "Name", value: "vitalik.eth" });
    expect(m.pivots).toEqual([{ label: "Etherscan", url: "https://etherscan.io" }]);
    expect(m.observables).toEqual([]);
  });

  it("omits sections and headline when the address is unresolved", () => {
    const data = { input: "1BTCbad", chain: null, facts: null, pivots: [] } as unknown as WalletLookupResponse;
    const m = buildWalletReport(data);
    expect(m.headline).toBeUndefined();
    expect(m.sections).toEqual([]);
    expect(m.summary).toEqual([{ label: "Address", value: "1BTCbad" }]);
  });
});

describe("buildHashReport", () => {
  it("builds reputation and cross-hash sections and a file observable", () => {
    const data = {
      input: "abc123", kind: "sha256",
      facts: { kind: "sha256", input: "abc123", known: true, fileName: "notepad.exe", fileSize: 12345, productName: "Windows", source: "NSRL", database: "nsrl_modern", trust: 95, md5: "m", sha1: "s1", sha256: "abc123" },
      pivots: [{ label: "VirusTotal", url: "https://virustotal.com", note: "x" }],
      sourceHealth: [{ source: "circl", ok: true, ms: 7, fetchedAt: 0 }],
    } as unknown as HashLookupResponse;

    const m = buildHashReport(data);
    expect(m.kind).toBe("hash");
    expect(m.headline).toEqual({ label: "Verdict", value: "Known software (catalogued benign)" });
    expect(m.sections.find((s) => s.heading === "Known-software reputation")?.rows).toContainEqual({ label: "Product", value: "Windows" });
    expect(m.sections.find((s) => s.heading === "Cross-algorithm hashes")?.rows).toContainEqual({ label: "SHA-256", value: "abc123" });
    expect(m.observables).toEqual([{ type: "file", value: "abc123", hashAlg: "SHA-256" }]);
  });

  it("reports an unknown hash with no facts", () => {
    const data = { input: "deadbeef", kind: null, facts: null, pivots: [] } as unknown as HashLookupResponse;
    const m = buildHashReport(data);
    expect(m.headline).toEqual({ label: "Verdict", value: "Unknown (not in known-software catalog)" });
    expect(m.sections).toEqual([]);
    expect(m.observables).toEqual([]);
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

const withAi: ReportModel = {
  ...model,
  summary: [{ label: "Domain", value: "acme.test" }],
  assessment: {
    score: 40, band: "elevated", confidence: "medium", rationale: "Elevated by exposed services.",
    factors: [{ label: "Exposed service", share: 1, evidence: "port 22 open" }],
    anomalies: [{ title: "Odd pairing", severity: "warn", detail: "hosting and residential" }],
    narrative: ["acme.test scores 40 out of 100.", "It weighs only collected evidence."],
  },
};

// An assessment with no factors, no anomalies and no narrative, plus a band not
// in the colour table — exercises every "empty"/fallback branch of the renderers.
const withCleanAi: ReportModel = {
  ...noHeadline,
  observables: [], // also exercises the "no observables" branch of every renderer
  assessment: {
    score: 4, band: "unknown-band", confidence: "low", rationale: "No elevated signals.",
    factors: [], anomalies: [], narrative: [],
  },
};

describe("reportToText", () => {
  it("renders masthead, executive summary, sections, sources and pivots", () => {
    const t = reportToText(model);
    expect(t).toContain("Domain Intelligence Report");
    expect(t).toContain("CONTENTS");                 // numbered index
    expect(t).toContain("01. EXECUTIVE SUMMARY");    // first indexed section
    expect(t).toContain("EXECUTIVE SUMMARY");
    expect(t).toContain("grade B");
    expect(t).toContain("• www.acme.test");
    expect(t).toContain("OK  dns · 30ms");
    expect(t).toContain("ERR whois");
    expect(t).toContain("crt.sh: https://crt.sh");
    expect(t).toContain("METHODOLOGY & CAVEATS");
    expect(t).toContain("APPENDIX: OBSERVABLES (STIX)");
    expect(t).toContain("domain-name");
  });
  it("skips headline/sources/pivots/assessment blocks when empty", () => {
    const t = reportToText(noHeadline);
    expect(t).not.toContain("HTTP headers");
    expect(t).not.toContain("DATA SOURCES");
    expect(t).not.toContain("INVESTIGATIVE PIVOTS");
    expect(t).not.toContain("RISK ASSESSMENT");
    expect(t).not.toContain("ANALYST NARRATIVE");
  });
  it("renders the risk assessment, factors, patterns and narrative when present", () => {
    const t = reportToText(withAi);
    expect(t).toContain("RISK ASSESSMENT");
    expect(t).toContain("40/100 (elevated), confidence medium");
    expect(t).toContain("Exposed service (100%): port 22 open");
    expect(t).toContain("Odd pairing (warn): hosting and residential");
    expect(t).toContain("ANALYST NARRATIVE");
    expect(t).toContain("acme.test scores 40 out of 100.");
  });
  it("renders a bare assessment without factors, patterns or narrative", () => {
    const t = reportToText(withCleanAi);
    expect(t).toContain("RISK ASSESSMENT");
    expect(t).not.toContain("Contributing factors:");
    expect(t).not.toContain("Flagged patterns:");
    expect(t).not.toContain("ANALYST NARRATIVE");
  });
});

describe("reportToMarkdown", () => {
  it("renders a table, list and escapes pipes", () => {
    const md = reportToMarkdown(model);
    expect(md).toContain("# HEAVEN-GeoIntel: domain intelligence report: acme.test");
    expect(md).toContain("## Contents");                            // index heading
    expect(md).toContain("- [Methodology & caveats](#methodology-caveats)"); // anchor link
    expect(md).toContain("| Field | Value |");
    expect(md).toContain("| MX | a \\| b |"); // pipe escaped
    expect(md).toContain("- www.acme.test");
    expect(md).toContain("- ✅ dns (30ms)");
    expect(md).toContain("- ❌ whois");
    expect(md).toContain("## Methodology & caveats");
    expect(md).toContain("- `domain-name`: acme.test");
    expect(md).toContain("- [crt.sh](https://crt.sh)");
  });
  it("escapes a backslash before the pipe so a cell can't reopen a delimiter", () => {
    const m: ReportModel = { ...model, sections: [{ heading: "X", rows: [{ label: "L", value: "a\\|b" }] }] };
    const md = reportToMarkdown(m);
    expect(md).toContain("| L | a\\\\\\|b |");
  });
  it("omits the headline, sources, pivots and assessment when absent", () => {
    const md = reportToMarkdown(noHeadline);
    expect(md).not.toContain("HTTP headers");
    expect(md).not.toContain("## Data sources");
    expect(md).not.toContain("## Investigative pivots");
    expect(md).not.toContain("## Risk assessment");
    expect(md).not.toContain("## Executive summary"); // no summary rows
  });
  it("renders the executive summary, risk assessment and narrative when present", () => {
    const md = reportToMarkdown(withAi);
    expect(md).toContain("## Executive summary");
    expect(md).toContain("## Risk assessment");
    expect(md).toContain("- Score: 40/100 (elevated), confidence medium");
    expect(md).toContain("**Contributing factors**");
    expect(md).toContain("- Exposed service (100%): port 22 open");
    expect(md).toContain("**Flagged patterns**");
    expect(md).toContain("## Analyst narrative");
    expect(md).toContain("- acme.test scores 40 out of 100.");
  });
  it("renders a bare assessment without factors, patterns or narrative", () => {
    const md = reportToMarkdown(withCleanAi);
    expect(md).toContain("## Risk assessment");
    expect(md).not.toContain("**Contributing factors**");
    expect(md).not.toContain("**Flagged patterns**");
    expect(md).not.toContain("## Analyst narrative");
  });
});

describe("reportToHtml", () => {
  it("renders a printable page with cover, tables, lists and escaping", () => {
    const html = reportToHtml({ ...model, sections: [{ heading: "DNS", rows: [{ label: "A", value: "<b>1.2.3.4</b>" }] }, { heading: "Subs", list: ["a&b"] }] });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<th>A</th><td>&lt;b&gt;1.2.3.4&lt;/b&gt;</td>");
    expect(html).toContain("<li>a&amp;b</li>");
    expect(html).toContain("Executive summary");
    expect(html).toContain(`<nav class="toc">`);                     // Contents index
    expect(html).toContain(`<a href="#executive-summary">Executive summary</a>`);
    expect(html).toContain(`<h2 id="executive-summary">Executive summary</h2>`);
    expect(html).toContain("@page");
  });
  it("drops the headline and assessment when absent", () => {
    const html = reportToHtml(noHeadline);
    expect(html).not.toContain("HTTP headers");
    expect(html).not.toContain("Risk assessment");
    expect(html).not.toContain("Analyst narrative");
  });
  it("renders the risk meter, factors, patterns and narrative when present", () => {
    const html = reportToHtml(withAi);
    expect(html).toContain("Risk assessment");
    expect(html).toContain("Contributing factors");
    expect(html).toContain("Flagged patterns");
    expect(html).toContain(`<h2 id="analyst-narrative">Analyst narrative</h2>`);
    expect(html).toContain("<li>acme.test scores 40 out of 100.</li>");
  });
  it("renders a bare assessment (fallback accent) without factors or narrative", () => {
    const html = reportToHtml(withCleanAi);
    expect(html).toContain("Risk assessment");
    expect(html).not.toContain("Contributing factors");
    expect(html).not.toContain("Analyst narrative");
    expect(html).toContain("#0a7a33"); // fallback accent for an unknown band
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

  it("emits a file SCO with a hashes dict and references the identity when there are no SCOs", () => {
    const fileBundle = reportToStixBundle({ ...model, observables: [{ type: "file", value: "abc123", hashAlg: "SHA-256" }] }) as { objects: Array<Record<string, unknown>> };
    const file = fileBundle.objects.find((o) => o.type === "file") as { hashes: Record<string, string> };
    expect(file.hashes).toEqual({ "SHA-256": "abc123" });

    // A file observable with no explicit algorithm falls back to SHA-256.
    const noAlg = reportToStixBundle({ ...model, observables: [{ type: "file", value: "xyz" }] }) as { objects: Array<Record<string, unknown>> };
    const f2 = noAlg.objects.find((o) => o.type === "file") as { hashes: Record<string, string> };
    expect(f2.hashes).toEqual({ "SHA-256": "xyz" });

    const empty = reportToStixBundle({ ...model, observables: [] }) as { objects: Array<Record<string, unknown>> };
    expect(empty.objects.map((o) => o.type)).toEqual(["identity", "report"]);
    const report = empty.objects.find((o) => o.type === "report") as { object_refs: string[] };
    expect(report.object_refs).toHaveLength(1);
    expect(report.object_refs[0]).toContain("identity--");
  });
});
