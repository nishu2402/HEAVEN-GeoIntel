import { describe, it, expect } from "vitest";
import {
  buildPhoneReport, buildEmailReport, buildUsernameReport, buildIpReport,
  buildDomainReport, buildWalletReport, buildHashReport,
  reportToText, reportToMarkdown, reportToStixBundle, detUuid,
  reportOutline, reportStats, reportMeta, statsRows, controlRows, sourceState,
  bandInk, bandNeon, observableStixId,
  type ReportModel,
} from "@/lib/analysis/report";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse,
  DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
} from "@/lib/types";

// ── Builders ─────────────────────────────────────────────────────────────────

describe("buildPhoneReport", () => {
  it("builds number, SIM, geo and risk sections plus a grounded assessment", () => {
    const data = {
      input: { e164: "+14155552671", isValid: true, countryCallingCode: "1" },
      analysis: { e164: "+14155552671" },
      offline: { confidence: "medium" },
      aggregated: {
        formatInternational: "+1 415-555-2671", formatNational: "(415) 555-2671",
        formatRfc3966: "tel:+1-415-555-2671", typeDescription: "Mobile line",
        countryName: "United States", country: "US", region: "California", city: "San Francisco",
        timezone: ["America/Los_Angeles", "America/Denver"], utcOffsets: ["-08:00"],
        areaCode: "415", numberLength: 11, carrierPrefix: "310", isAmbiguousType: false,
        isMobile: true, isFixedLine: false, isTollFree: false, isPremiumRate: false,
        lineType: "mobile", carrier: "Verizon", prepaid: false,
        active: true, activeStatus: "in service", userActivity: "high",
        mobileCountryCode: "310", mobileNetworkCode: "004",
        callerName: "V. Example", callerType: "consumer",
        associatedEmails: ["a@example.com"],
        fraudScore: 12, isRisky: false, recentAbuse: false, isVoip: false, isDisposable: false,
      },
      assignability: { assignable: true, reason: null, detail: "A subscriber can hold this number.", block: null },
      breachAggregate: {
        total: 2, verified: 1, withPassword: 1, enrichedCount: 1,
        firstBreach: "2014", lastBreach: "2021",
        sourcesReporting: ["LeakCheck"], sourcesAnswered: ["LeakCheck", "XposedOrNot"],
        dataClasses: ["Emails", "Phone numbers"],
        breaches: [
          { name: "Acme", date: "2021-02", records: 1500000, dataClasses: ["Emails"], password: true, verified: true },
          { name: "Nodate", date: null, records: null, dataClasses: [], password: false, verified: false },
        ],
      },
      credentialExposure: {
        exposed: true, reuse: "likely", distinctPasswords: 2, pairs: 3, capped: true,
        passwordBreaches: 3, stealerLogs: 1, stealerPasswords: 1,
      },
      threatScore: 12, threatLabel: "LOW RISK",
      sourceHealth: [
        { source: "libphonenumber", ok: true, ms: 1, fetchedAt: 0 },
        { source: "ipqs", ok: false, ms: 0, fetchedAt: 0, skipped: true },
        { source: "twilio", ok: false, ms: 9, fetchedAt: 0, error: "timeout" },
      ],
    } as unknown as LookupResponse;

    const m = buildPhoneReport(data);
    expect(m.kind).toBe("phone");
    expect(m.subject).toBe("+14155552671");
    expect(m.headline).toEqual({ label: "Abuse risk", value: "12/100: LOW RISK" });
    // Assignability leads, because it governs how every later row reads.
    expect(m.sections[0]!.heading).toBe("Assignability");
    expect(m.sections.find((s) => s.heading === "Number")?.rows).toContainEqual({ label: "RFC 3966", value: "tel:+1-415-555-2671" });
    expect(m.sections.find((s) => s.heading === "Carrier and SIM")?.rows).toContainEqual({ label: "Carrier", value: "Verizon" });
    expect(m.sections.find((s) => s.heading === "Carrier and SIM")?.rows).toContainEqual({ label: "Mobile network code", value: "004" });
    expect(m.sections.find((s) => s.heading === "Geolocation")?.rows).toContainEqual({ label: "Country", value: "United States (US)" });
    expect(m.sections.find((s) => s.heading === "Geolocation")?.rows).toContainEqual({ label: "Timezones", value: "America/Los_Angeles, America/Denver" });
    expect(m.sections.find((s) => s.heading === "Risk signals")?.rows).toContainEqual({ label: "Fraud score", value: "12/100" });
    expect(m.sections.find((s) => s.heading === "Associated email addresses")?.list).toEqual(["a@example.com"]);
    // Breach and credential evidence render the same way in every mode.
    const breach = m.sections.find((s) => s.heading === "Breach exposure")!.rows!;
    expect(breach).toContainEqual({ label: "Verified by a source", value: "1" });
    expect(breach).toContainEqual({ label: "Sources that answered", value: "LeakCheck, XposedOrNot" });
    const named = m.sections.find((s) => s.heading === "Breaches by name")!.list!;
    expect(named[0]).toBe("Acme (2021-02) · 1,500,000 records · Emails · password exposed, verified");
    expect(named[1]).toBe("Nodate"); // no date, no count, no classes, no marks
    const cred = m.sections.find((s) => s.heading === "Credential exposure")!.rows!;
    expect(cred).toContainEqual({ label: "Reuse assessment", value: "likely" });
    expect(cred).toContainEqual({ label: "Distinct leaked passwords", value: "2 (floor)" });
    expect(cred.some((r) => r.label === "Source page truncated")).toBe(true);
    expect(m.summary).toContainEqual({ label: "Number", value: "+14155552671" });
    expect(m.summary).toContainEqual({ label: "Can hold a subscriber", value: "Yes" });
    expect(m.assessment?.narrative.length).toBeGreaterThan(0);
    expect(m.observables).toEqual([]);
    // A source with no key was never called, and carries that fact rather than
    // looking like the one that timed out.
    expect(m.sources).toEqual([
      { source: "libphonenumber", ok: true, ms: 1 },
      { source: "ipqs", ok: false, ms: 0, skipped: true },
      { source: "twilio", ok: false, ms: 9, error: "timeout" },
    ]);
  });

  it("renders a credential section with only the fields that hold a number", () => {
    const m = buildPhoneReport({
      input: { e164: "+14155552671", isValid: true, countryCallingCode: "1" },
      analysis: { e164: "+14155552671" }, offline: { confidence: "low" },
      aggregated: {
        isAmbiguousType: false, formatInternational: null, formatNational: null, formatRfc3966: null,
        typeDescription: null, countryName: null, country: null, region: null, city: null,
        areaCode: null, numberLength: null, carrierPrefix: null, timezone: null, utcOffsets: null,
        lineType: null, carrier: null, prepaid: null, isMobile: null, isFixedLine: null,
        isTollFree: null, isPremiumRate: null, active: null, activeStatus: null, userActivity: null,
        mobileCountryCode: null, mobileNetworkCode: null, callerName: null, callerType: null,
        associatedEmails: null, fraudScore: null, isRisky: null, recentAbuse: null, isVoip: null, isDisposable: null,
      },
      // Exposed, but every count is a zero: a row that would read "0" is a row
      // that says nothing, so it is left out.
      credentialExposure: {
        exposed: true, reuse: "exposed", distinctPasswords: 0, pairs: 0, capped: false,
        passwordBreaches: 0, stealerLogs: 0, stealerPasswords: 0,
      },
      threatScore: 0, threatLabel: "UNKNOWN",
    } as unknown as LookupResponse);
    expect(m.sections.find((s) => s.heading === "Credential exposure")?.rows)
      .toEqual([{ label: "Reuse assessment", value: "exposed" }]);
  });

  it("omits empty sections when the number is bare", () => {
    const data = {
      input: { e164: "+9999999", isValid: false, countryCallingCode: "" },
      analysis: { e164: "+9999999" },
      offline: { confidence: "low" },
      aggregated: {
        formatInternational: null, formatNational: null, formatRfc3966: null, typeDescription: null,
        countryName: null, country: null, isAmbiguousType: false,
        region: null, city: null, areaCode: null, numberLength: null, carrierPrefix: null,
        timezone: null, utcOffsets: null, lineType: null, carrier: null, prepaid: null,
        isMobile: null, isFixedLine: null, isTollFree: null, isPremiumRate: null,
        active: null, activeStatus: null, userActivity: null,
        mobileCountryCode: null, mobileNetworkCode: null, callerName: null, callerType: null,
        associatedEmails: null,
        fraudScore: null, isRisky: null, recentAbuse: null, isVoip: null, isDisposable: null,
      },
      threatScore: 0, threatLabel: "UNKNOWN",
    } as unknown as LookupResponse;
    const m = buildPhoneReport(data);
    // Only the Number section survives; everything else collapses to nothing,
    // and no assignability verdict is invented for a number that has none.
    expect(m.sections.map((s) => s.heading)).toEqual(["Number"]);
    expect(m.sources).toEqual([]);
    expect(m.summary?.some((r) => r.label === "Can hold a subscriber")).toBe(false);
  });

  it("spells out an ambiguous line type and a number no subscriber can hold", () => {
    const data = {
      input: { e164: "+15555555555", isValid: false, countryCallingCode: "1" },
      analysis: { e164: "+15555555555" }, offline: { confidence: "low" },
      aggregated: {
        isAmbiguousType: true, formatInternational: null, formatNational: null, formatRfc3966: null,
        typeDescription: null, countryName: null, country: null, region: null, city: null,
        areaCode: null, numberLength: null, carrierPrefix: null, timezone: null, utcOffsets: null,
        lineType: null, carrier: null, prepaid: null, isMobile: null, isFixedLine: null,
        isTollFree: null, isPremiumRate: null, active: null, activeStatus: null, userActivity: null,
        mobileCountryCode: null, mobileNetworkCode: null, callerName: null, callerType: null,
        associatedEmails: [], fraudScore: null, isRisky: null, recentAbuse: null, isVoip: null, isDisposable: null,
      },
      assignability: { assignable: false, reason: "fictional", detail: "Reserved for fiction.", block: "555-01xx" },
      threatScore: 0, threatLabel: "NOT ASSIGNABLE",
    } as unknown as LookupResponse;
    const m = buildPhoneReport(data);
    const rows = m.sections.find((s) => s.heading === "Assignability")!.rows!;
    expect(rows).toContainEqual({ label: "Can hold a subscriber", value: "No" });
    expect(rows).toContainEqual({ label: "Reserved block", value: "555-01xx" });
    expect(m.sections.find((s) => s.heading === "Number")?.rows?.some((r) => r.label === "Type is ambiguous")).toBe(true);
    // An empty list is not a section.
    expect(m.sections.some((s) => s.heading === "Associated email addresses")).toBe(false);
  });
});

describe("buildEmailReport", () => {
  it("builds classification, reputation, breach and profile sections", () => {
    const data = {
      email: "target@example.com",
      analysis: { providerName: "Custom Corporate", providerType: "corporate", isDisposable: false, isRoleAddress: false, isWebmail: false, isPrivacyFocused: false },
      gravatar: { found: true, displayName: "Target", currentLocation: "NYC", profileUrl: "https://gravatar.com/x", accounts: [{ shortname: "gh", username: "t", url: "https://github.com/t" }] },
      mail: { ok: true, data: { hasMx: true, mxHosts: ["aspmx.l.google.com"], provider: "Google Workspace", category: "cloud" } },
      emailrep: { ok: true, data: { reputation: "high", suspicious: false, blacklisted: false, maliciousActivity: false, credentialsLeaked: true, deliverable: true, spoofable: false } },
      breachAggregate: {
        total: 3, verified: 0, withPassword: 2, enrichedCount: 0, firstBreach: null, lastBreach: null,
        sourcesReporting: ["XposedOrNot"], sourcesAnswered: ["XposedOrNot"],
        dataClasses: ["Emails", "Passwords"],
        breaches: [{ name: "Acme", date: "2019", records: 10, dataClasses: ["Emails"], password: false, verified: false }],
      },
      credentialExposure: { exposed: false, reuse: "none", distinctPasswords: 0, pairs: 0, capped: false, passwordBreaches: 0, stealerLogs: 0, stealerPasswords: 0 },
      sourceHealth: [{ source: "xon", ok: true, ms: 5, fetchedAt: 0 }],
    } as unknown as EmailLookupResponse;

    const m = buildEmailReport(data);
    expect(m.kind).toBe("email");
    expect(m.subject).toBe("target@example.com");
    expect(m.headline?.label).toBe("Risk");
    expect(m.sections.find((s) => s.heading === "Classification")?.rows).toContainEqual({ label: "Provider", value: "Custom Corporate" });
    expect(m.sections.find((s) => s.heading === "Mail exchange")?.rows).toContainEqual({ label: "Provider", value: "Google Workspace" });
    expect(m.sections.find((s) => s.heading === "Reputation")?.rows).toContainEqual({ label: "Credentials leaked", value: "Yes" });
    expect(m.sections.find((s) => s.heading === "Breach exposure")?.rows).toContainEqual({ label: "Breaches", value: "3" });
    // Nothing was exposed, so no credential section is invented for it.
    expect(m.sections.some((s) => s.heading === "Credential exposure")).toBe(false);
    expect(m.sections.find((s) => s.heading === "Gravatar profile")?.rows).toContainEqual({ label: "Display name", value: "Target" });
    expect(m.sections.find((s) => s.heading === "Gravatar linked accounts")?.list).toEqual(["gh: https://github.com/t"]);
    expect(m.summary).toContainEqual({ label: "Mail exchange", value: "Google Workspace" });
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
      mail: { ok: false, error: "x" },
      breachAggregate: {
        total: 1, verified: 0, withPassword: 0, enrichedCount: 0, firstBreach: null, lastBreach: null,
        sourcesReporting: [], sourcesAnswered: [], dataClasses: [], breaches: [],
      },
    } as unknown as EmailLookupResponse;
    const m = buildEmailReport(data);
    expect(m.sections.find((s) => s.heading === "Breach exposure")?.rows).toEqual([{ label: "Breaches", value: "1" }]);
    // An aggregate with no named breaches is not a "Breaches by name" section.
    expect(m.sections.some((s) => s.heading === "Breaches by name")).toBe(false);
    expect(m.sections.some((s) => s.heading === "Mail exchange")).toBe(false);
  });
});

describe("buildUsernameReport", () => {
  it("builds a full model from a rich username response", () => {
    const data = {
      username: "torvalds", checked: 30, found: 2, manual: 4,
      hits: [
        { site: "GitHub", category: "dev", url: "https://github.com/torvalds", status: "found" },
        { site: "Nope", category: "dev", url: "x", status: "notfound" },
        { site: "Instagram", category: "social", url: "https://instagram.com/torvalds", status: "manual" },
      ],
      profiles: [
        { platform: "GitHub", category: "dev", handle: "torvalds", url: "https://github.com/torvalds", avatarUrl: null, displayName: "Linus", bio: null, stats: [{ label: "repos", value: "42" }], joinedYear: "2011", location: "Portland", extra: null },
        { platform: "Reddit", category: "dev", handle: "t", url: "https://reddit.com/u/t", avatarUrl: null, displayName: null, bio: null, stats: [], joinedYear: null, location: null, extra: null },
      ],
      identity: {
        names: [{ value: "Linus Torvalds", source: "GitHub" }],
        locations: [{ value: "Portland", source: "GitHub" }],
        avatars: [{ url: "https://avatars.example/1", source: "GitHub" }],
        bios: [{ value: "kernel person", source: "GitHub" }],
      },
      pivots: [{ label: "Google", url: "https://g.co" }],
      leakCheck: { ok: false }, hudsonRock: { ok: false },
      breachAggregate: {
        total: 4, verified: 0, withPassword: 0, enrichedCount: 0, firstBreach: null, lastBreach: null,
        sourcesReporting: ["LeakCheck"], sourcesAnswered: ["LeakCheck"], dataClasses: [], breaches: [],
      },
      sourceHealth: [{ source: "usernameSweep", ok: true, ms: 100, fetchedAt: 0 }],
    } as unknown as UsernameLookupResponse;

    const m = buildUsernameReport(data);
    expect(m.kind).toBe("username");
    expect(m.subject).toBe("torvalds");
    expect(m.headline).toEqual({ label: "Confirmed accounts", value: "2 of 30" });
    expect(m.sections.find((s) => s.heading === "Confirmed accounts")?.list).toEqual(["GitHub (dev): https://github.com/torvalds"]);
    // A site a probe cannot decide is listed apart from the confirmed ones.
    expect(m.sections.find((s) => s.heading === "Open to verify (not confirmed)")?.list)
      .toEqual(["Instagram (social): https://instagram.com/torvalds"]);
    expect(m.sections.find((s) => s.heading === "Verified profiles")?.list?.[0]).toContain("Linus");
    expect(m.sections.find((s) => s.heading === "Profile metrics")?.list).toEqual(["GitHub: repos 42"]);
    expect(m.sections.find((s) => s.heading === "Identity signals: names")?.list).toEqual(["Linus Torvalds (GitHub)"]);
    expect(m.sections.find((s) => s.heading === "Identity signals: locations")?.list).toEqual(["Portland (GitHub)"]);
    expect(m.sections.find((s) => s.heading === "Identity signals: biographies")?.list).toEqual(["GitHub: kernel person"]);
    expect(m.sections.find((s) => s.heading === "Identity signals: avatars")?.list).toEqual(["GitHub: https://avatars.example/1"]);
    expect(m.sections[0].rows).toContainEqual({ label: "Open-to-verify sites", value: "4" });
    expect(m.summary).toContainEqual({ label: "Locations found", value: "1" });
    expect(m.summary).toContainEqual({ label: "Breaches", value: "4" });
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
        asn: 15169, asnOrg: "Google LLC", isp: "Google", isVpn: false, isTor: null, isHosting: true, isMobile: false,
        flagEmoji: "🇺🇸", reverse: "dns.google", ports: [53, 443], vulns: ["CVE-1"],
        abuseContact: "abuse@google.com", prefix: "8.8.8.0/24", announcedPrefixes: 42,
        org: "Google Public DNS", isProxy: false,
        hostnames: ["dns.google"], tags: ["cdn"],
        greyNoise: { classification: "benign", noise: true, riot: true, name: "Google", lastSeen: "2026-09-01" },
      },
      classification: { scope: "global", label: "Global unicast", description: "A normal public address.", isGloballyRoutable: true, rfc: null },
      pivots: [{ label: "Shodan", url: "https://shodan.io", note: "x" }],
      threatScore: 65, threatLabel: "MODERATE",
      sourceHealth: [{ source: "ip-api.com", ok: true, ms: 20, fetchedAt: 0 }],
    } as unknown as IpLookupResponse;

    const m = buildIpReport(data);
    expect(m.headline).toEqual({ label: "Threat", value: "65/100: MODERATE" });
    expect(m.sections.find((s) => s.heading === "Address scope")?.rows).toContainEqual({ label: "Scope", value: "Global unicast" });
    expect(m.sections.find((s) => s.heading === "Geolocation")?.rows).toContainEqual({ label: "Continent", value: "NA" });
    const net = m.sections.find((s) => s.heading === "Network / ASN")!;
    expect(net.rows).toContainEqual({ label: "Abuse contact", value: "abuse@google.com" });
    expect(net.rows).toContainEqual({ label: "ASN prefixes", value: "42" });
    expect(net.rows).toContainEqual({ label: "Organisation", value: "Google Public DNS" });
    expect(m.sections.find((s) => s.heading === "Risk flags")?.rows).toContainEqual({ label: "Hosting", value: "Yes" });
    expect(m.sections.find((s) => s.heading === "Internet-scanner classification")?.rows)
      .toContainEqual({ label: "Common business service", value: "Yes" });
    expect(m.sections.find((s) => s.heading === "Open ports")?.list).toEqual(["53", "443"]);
    expect(m.sections.find((s) => s.heading === "Hostnames")?.list).toEqual(["dns.google"]);
    expect(m.sections.find((s) => s.heading === "Exposure tags")?.list).toEqual(["cdn"]);
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

    const v6 = { input: "2606:4700::1", ip: { type: "IPv6", asn: null, ports: null, vulns: null, hostnames: null, tags: null, greyNoise: null, isProxy: null, isVpn: null, isHosting: null, isTor: null, isMobile: null } as unknown, pivots: [], threatScore: 0, threatLabel: "CLEAN" } as unknown as IpLookupResponse;
    expect(buildIpReport(v6).observables).toEqual([{ type: "ipv6-addr", value: "2606:4700::1" }]);
    // No risk-flag section when every flag is null, and no scanner section when
    // GreyNoise had nothing: an absent source is not a clean verdict.
    expect(buildIpReport(v6).sections.some((s) => s.heading === "Risk flags")).toBe(false);
    expect(buildIpReport(v6).sections.some((s) => s.heading === "Internet-scanner classification")).toBe(false);
    expect(buildIpReport(v6).sections.some((s) => s.heading === "Hostnames")).toBe(false);
  });
});

describe("buildDomainReport", () => {
  const base = {
    domain: "acme.test", isValid: true,
    dns: { a: [{ type: "A", value: "1.2.3.4" }], aaaa: [{ type: "AAAA", value: "2606:4700::1" }], mx: [{ type: "MX", value: "mail.acme.test" }], txt: [], ns: [{ type: "NS", value: "ns1.acme.test" }], cname: [] },
    emailSecurity: { hasSpf: true, spf: "v=spf1", hasDmarc: true, dmarcPolicy: "reject", hasMx: true, nullMx: false },
    subdomains: [], pivots: [{ label: "crt.sh", url: "https://crt.sh", note: "x" }], dnssec: true, wayback: null, http: null,
  };

  it("states a null MX as a declared refusal, not as a missing record", () => {
    const model = buildDomainReport({
      ...base, whois: null,
      dns: { ...base.dns, mx: [{ type: "MX", value: ".", priority: 0 }] },
      emailSecurity: { hasSpf: true, spf: "v=spf1 -all", hasDmarc: true, dmarcPolicy: "reject", hasMx: false, nullMx: true },
    } as unknown as DomainLookupResponse);
    const mail = model.sections.find((s) => s.heading === "Email security");
    expect(mail!.rows!.find((r) => r.label === "MX")!.value).toBe("declared none (RFC 7505 null MX)");
  });

  it("builds DNS, email security, WHOIS, subdomains and takeover sections", () => {
    const data = {
      ...base, whois: { registrar: "R Inc", createdDate: "2001-01-01", updatedDate: "2024-01-01", expiresDate: "2030-01-01", nameservers: ["ns1.acme.test"], statuses: ["clientTransferProhibited"], registrantOrg: "Acme", registrantCountry: "US" },
      subdomains: ["www.acme.test", "api.acme.test"],
      takeoverCandidates: [
        { name: "vuln.acme.test", host: "x.github.io", service: "GitHub Pages", status: "edge-case", fingerprint: "fp", markers: ["fp"], reference: "ref", verification: "unclaimed" },
        { name: "gone.acme.test", host: "y.azurewebsites.net", service: "Microsoft Azure", status: "vulnerable", fingerprint: "fp", markers: ["fp"], reference: "ref", verification: "unverified" },
      ],
      wayback: { available: true, firstSnapshot: "2003-04-01", snapshotUrl: "https://web.archive.org/x" },
      knownBreaches: [
        { name: "AcmeLeak", domain: "acme.test", date: "2016-05", records: 1234567, dataClasses: ["Emails"], verified: true },
        { name: "Undated", domain: null, date: null, records: null, dataClasses: [], verified: false },
      ],
      http: {
        url: "https://acme.test", status: 200, redirectChain: ["301 http://acme.test → https://acme.test"], httpsRedirect: true,
        security: {
          checks: [
            { name: "Strict-Transport-Security", present: true, value: "max-age=63072000", score: 2, max: 2, note: "Long max-age." },
            { name: "Content-Security-Policy", present: false, value: null, score: 0, max: 3, note: "Not set." },
            { name: "X-Frame-Options", present: true, value: null, score: 1, max: 1, note: "Covered by CSP." },
          ],
          score: 8, max: 10, percent: 80, grade: "B",
        },
        tech: [
          { name: "nginx", kind: "server", version: "1.25.3", evidence: "Server header" },
          { name: "Cloudflare", kind: "cdn", version: null, evidence: "CF-Ray header" },
        ],
        disclosures: [
          { header: "Server", value: "nginx/1.25.3", hasVersion: true },
          { header: "X-Powered-By", value: "Express", hasVersion: false },
        ],
        cookies: [
          { name: "sid", secure: true, httpOnly: true, sameSite: "Lax" },
          { name: "legacy", secure: false, httpOnly: false, sameSite: null },
        ],
        title: "Acme",
        tls: { protocol: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", issuer: "Acme CA", subject: "acme.test", altNames: ["acme.test", "www.acme.test"], validFrom: "2026-01-01", validTo: "2027-01-01", daysRemaining: 111, trusted: true, trustError: null },
      },
      sourceHealth: [{ source: "dns", ok: true, ms: 30, fetchedAt: 0 }],
    } as unknown as DomainLookupResponse;

    const m = buildDomainReport(data);
    expect(m.headline).toEqual({ label: "HTTP headers", value: "grade B" });
    expect(m.sections.find((s) => s.heading === "DNS")?.rows).toContainEqual({ label: "A", value: "1.2.3.4" });
    expect(m.sections.find((s) => s.heading === "DNS")?.rows).toContainEqual({ label: "DNSSEC", value: "signed" });
    expect(m.sections.find((s) => s.heading === "WHOIS")?.rows).toContainEqual({ label: "Registrar", value: "R Inc" });
    expect(m.sections.find((s) => s.heading === "WHOIS")?.rows).toContainEqual({ label: "Status codes", value: "clientTransferProhibited" });
    // The HTTP posture, TLS and fingerprints used to be collected and then
    // dropped on the floor by the report.
    const http = m.sections.find((s) => s.heading === "HTTP posture")!.rows!;
    expect(http).toContainEqual({ label: "Security-header grade", value: "B (8 of 10, 80%)" });
    expect(http).toContainEqual({ label: "Upgrades HTTP to HTTPS", value: "yes" });
    const checks = m.sections.find((s) => s.heading === "Security-header checks")!.list!;
    expect(checks[0]).toBe("Strict-Transport-Security (present, 2 of 2): max-age=63072000 · Long max-age.");
    expect(checks[1]).toBe("Content-Security-Policy (absent, 0 of 3) · Not set.");
    expect(checks[2]).toBe("X-Frame-Options (present, 1 of 1) · Covered by CSP."); // present, no value
    expect(m.sections.find((s) => s.heading === "Technology fingerprints")?.list).toEqual([
      "nginx 1.25.3 (server) from Server header",
      "Cloudflare (cdn) from CF-Ray header",
    ]);
    expect(m.sections.find((s) => s.heading === "Version disclosures")?.list).toEqual([
      "Server: nginx/1.25.3 (exposes a version)", "X-Powered-By: Express",
    ]);
    expect(m.sections.find((s) => s.heading === "Cookie flags")?.list).toEqual([
      "sid: Secure yes, HttpOnly yes, SameSite Lax", "legacy: Secure no, HttpOnly no, SameSite unset",
    ]);
    expect(m.sections.find((s) => s.heading === "TLS certificate")?.rows).toContainEqual({ label: "Days remaining", value: "111" });
    expect(m.sections.find((s) => s.heading === "Internet Archive")?.rows).toContainEqual({ label: "First snapshot", value: "2003-04-01" });
    // The heading says whose breaches these are: the domain's, not its users'.
    const known = m.sections.find((s) => s.heading === "Breaches catalogued for this domain")!.list!;
    expect(known[0]).toBe("AcmeLeak (2016-05) · 1,234,567 records · Emails · verified");
    expect(known[1]).toBe("Undated");
    expect(m.sections.find((s) => s.heading === "Subdomains (2)")?.list).toHaveLength(2);
    expect(m.summary).toContainEqual({ label: "TLS", value: "Acme CA, trusted" });
    expect(m.summary).toContainEqual({ label: "Takeover candidates", value: "2" });
    const takeover = m.sections.find((s) => s.heading === "Subdomain-takeover candidates")?.list;
    expect(takeover?.[0]).toContain("GitHub Pages");
    // The two verification states read differently: one is actionable, one is not.
    expect(takeover?.[0]).toContain("confirmed unclaimed");
    expect(takeover?.[1]).toContain("unverified: host did not answer");
    expect(m.observables).toEqual([{ type: "domain-name", value: "acme.test" }, { type: "ipv4-addr", value: "1.2.3.4" }]);
  });

  it("renders a missing email posture and a policy-less DMARC", () => {
    const missing = buildDomainReport({ ...base, whois: null, emailSecurity: { hasSpf: false, spf: null, hasDmarc: false, dmarcPolicy: null, hasMx: false, nullMx: false } } as unknown as DomainLookupResponse);
    const rows = missing.sections.find((s) => s.heading === "Email security")!.rows!;
    expect(rows).toContainEqual({ label: "SPF", value: "missing" });
    expect(rows).toContainEqual({ label: "DMARC", value: "missing" });
    expect(rows).toContainEqual({ label: "MX", value: "no" });

    const setPolicy = buildDomainReport({ ...base, whois: null, emailSecurity: { hasSpf: true, spf: "x", hasDmarc: true, dmarcPolicy: null, hasMx: true, nullMx: false } } as unknown as DomainLookupResponse);
    expect(setPolicy.sections.find((s) => s.heading === "Email security")!.rows).toContainEqual({ label: "DMARC", value: "set" });
  });

  it("renders a CNAME row and counts the remainder of a long list", () => {
    const m = buildDomainReport({
      ...base, whois: {
        registrar: null, createdDate: null, updatedDate: null, expiresDate: null,
        registrantOrg: null, registrantCountry: null, statuses: [],
        // Nine nameservers against a cap of eight: the ninth is counted, never
        // dropped in silence.
        nameservers: ["ns1", "ns2", "ns3", "ns4", "ns5", "ns6", "ns7", "ns8", "ns9"],
      },
      dns: {
        ...base.dns,
        cname: [{ type: "CNAME", value: "alias.acme.test" }],
        txt: [{ type: "TXT", value: "v=spf1 include:_spf.acme.test ~all" }],
      },
    } as unknown as DomainLookupResponse);
    expect(m.sections.find((s) => s.heading === "DNS")?.rows).toContainEqual({ label: "CNAME", value: "alias.acme.test" });
    expect(m.sections.find((s) => s.heading === "TXT records")?.list).toEqual(["v=spf1 include:_spf.acme.test ~all"]);
    expect(m.sections.find((s) => s.heading === "WHOIS")?.rows).toContainEqual({
      label: "Nameservers", value: "ns1, ns2, ns3, ns4, ns5, ns6, ns7, ns8, and 1 more",
    });
  });

  it("reports an unanswered DNS query as unknown, never as missing", () => {
    const m = buildDomainReport({
      ...base, whois: null, dnsFailed: ["MX", "TXT", "DMARC"],
      emailSecurity: { hasSpf: null, spf: null, hasDmarc: null, dmarcPolicy: null, hasMx: null, nullMx: false },
    } as unknown as DomainLookupResponse);
    expect(m.sections.find((s) => s.heading === "Email security")!.rows).toEqual([
      { label: "SPF", value: "unknown (no DNS answer)" },
      { label: "DMARC", value: "unknown (no DNS answer)" },
      { label: "MX", value: "unknown (no DNS answer)" },
    ]);
    expect(m.sections.find((s) => s.heading === "DNS")!.rows).toContainEqual({ label: "No answer for", value: "MX, TXT, DMARC" });
    expect(m.summary).toContainEqual({ label: "Email posture", value: "SPF unknown (no DNS answer), DMARC unknown (no DNS answer)" });
    expect(JSON.stringify(m)).not.toContain("missing");
  });

  it("omits WHOIS/subdomains/takeover/http when absent", () => {
    const data = { ...base, whois: null, dnssec: null } as unknown as DomainLookupResponse;
    const m = buildDomainReport(data);
    expect(m.headline).toBeUndefined();
    // `base` publishes an SPF record, so Email security carries its value too.
    expect(m.sections.map((s) => s.heading)).toEqual(["DNS", "Email security"]);
    expect(m.sections[1]!.rows).toContainEqual({ label: "SPF record", value: "v=spf1" });
    expect(m.sources).toEqual([]);
    expect(m.summary).toContainEqual({ label: "DNSSEC", value: "unknown (no DNS answer)" });
  });

  it("reports an untrusted certificate and an unarchived domain without inventing either", () => {
    const m = buildDomainReport({
      ...base, whois: null,
      wayback: { available: false, firstSnapshot: null, snapshotUrl: null },
      http: {
        url: "https://acme.test", status: 526, redirectChain: [], httpsRedirect: null,
        security: { checks: [], score: 0, max: 10, percent: 0, grade: "F" },
        tech: [], disclosures: [], cookies: [], title: null,
        tls: { protocol: null, cipher: null, issuer: null, subject: null, altNames: [], validFrom: null, validTo: null, daysRemaining: null, trusted: false, trustError: "self signed certificate" },
      },
    } as unknown as DomainLookupResponse);
    expect(m.sections.find((s) => s.heading === "HTTP posture")?.rows)
      .toContainEqual({ label: "Upgrades HTTP to HTTPS", value: "unknown (no DNS answer)" });
    expect(m.sections.find((s) => s.heading === "TLS certificate")?.rows)
      .toContainEqual({ label: "Trust error", value: "self signed certificate" });
    expect(m.sections.find((s) => s.heading === "Internet Archive")?.rows).toEqual([{ label: "Archived", value: "No" }]);
    // Empty collections stay out rather than printing as empty sections.
    for (const gone of ["Redirect chain", "Security-header checks", "Technology fingerprints", "Version disclosures", "Cookie flags", "Breaches catalogued for this domain"]) {
      expect(m.sections.some((s) => s.heading === gone)).toBe(false);
    }
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
    expect(m.sections.find((s) => s.heading === "On-chain")?.rows).toContainEqual({ label: "Balance in base units", value: "1500000000000000000" });
    expect(m.sections.find((s) => s.heading === "ENS identity")?.rows).toContainEqual({ label: "Name", value: "vitalik.eth" });
    // A confirmed name carries no warning.
    expect(m.sections.find((s) => s.heading === "ENS identity")?.rows?.some((r) => r.label === "Caution")).toBe(false);
    expect(m.pivots).toEqual([{ label: "Etherscan", url: "https://etherscan.io" }]);
    expect(m.observables).toEqual([]);
  });

  it("warns in words when a reverse ENS record does not resolve back", () => {
    const m = buildWalletReport({
      input: "0xabc", chain: "eth", facts: null,
      ens: { name: "spoof.eth", address: "0xabc", verified: false }, pivots: [],
    } as unknown as WalletLookupResponse);
    const caution = m.sections.find((s) => s.heading === "ENS identity")!.rows!.find((r) => r.label === "Caution")!;
    expect(caution.value).toContain("does not resolve back");
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
    expect(m.sections.find((s) => s.heading === "Submitted hash")?.rows).toContainEqual({ label: "Algorithm", value: "SHA256" });
    expect(m.sections.find((s) => s.heading === "Known-software reputation")?.rows).toContainEqual({ label: "Product", value: "Windows" });
    expect(m.sections.find((s) => s.heading === "Known-software reputation")?.rows).toContainEqual({ label: "File size", value: "12,345 bytes" });
    expect(m.sections.find((s) => s.heading === "Cross-algorithm hashes")?.rows).toContainEqual({ label: "SHA-256", value: "abc123" });
    expect(m.sections.find((s) => s.heading === "How to read this verdict")?.list?.[0]).toContain("catalogued release");
    expect(m.observables).toEqual([{ type: "file", value: "abc123", hashAlg: "SHA-256" }]);
  });

  it("says what an unknown hash does and does not mean, instead of leaving a blank report", () => {
    const data = { input: "deadbeef", kind: null, facts: null, pivots: [] } as unknown as HashLookupResponse;
    const m = buildHashReport(data);
    expect(m.headline).toEqual({ label: "Verdict", value: "Unknown (not in known-software catalog)" });
    expect(m.sections.map((s) => s.heading)).toEqual(["Submitted hash", "How to read this verdict"]);
    expect(m.sections[0]!.rows).toEqual([
      { label: "Value", value: "deadbeef" },
      { label: "Length", value: "8 hex characters" },
    ]);
    expect(m.sections[1]!.list?.[0]).toContain("not a malicious verdict");
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
  sources: [
    { source: "dns", ok: true, ms: 30 },
    { source: "whois", ok: false, error: "timeout" },
    { source: "hunter", ok: false, skipped: true },
  ],
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

describe("the shared document kit", () => {
  it("numbers one outline that every format follows", () => {
    expect(reportOutline(model)).toEqual([
      "Executive summary", "DNS", "Subdomains (1)", "Data sources",
      "Investigative pivots", "Methodology and limitations",
      "Appendix A: observables (STIX)", "Appendix B: collection statistics",
    ]);
    // Blocks with nothing in them drop out of the outline, and the risk and
    // narrative blocks appear only when the assessment carries them.
    expect(reportOutline(withCleanAi)).toEqual([
      "Executive summary", "Risk assessment", "DNS", "Subdomains (1)",
      "Methodology and limitations", "Appendix B: collection statistics",
    ]);
    expect(reportOutline(withAi)).toContain("Analyst narrative");
  });

  it("counts the evidence rather than estimating it", () => {
    const st = reportStats(withAi);
    expect(st).toMatchObject({
      sections: 2, fields: 3, items: 1, sources: 3,
      sourcesAnswered: 1, sourcesFailed: 1, sourcesUnconfigured: 1,
      pivots: 1, observables: 2, factors: 1, anomalies: 1,
    });
    // One latency among three sources: the median is that one.
    expect(st.medianMs).toBe(30);
    // No summary rows and no latencies at all.
    expect(reportStats(noHeadline)).toMatchObject({ fields: 2, sources: 0, medianMs: null });
    // An even number of latencies averages the middle pair.
    expect(reportStats({ ...model, sources: [{ source: "a", ok: true, ms: 10 }, { source: "b", ok: true, ms: 25 }] }).medianMs).toBe(18);
  });

  it("separates a source that failed from one that was never called", () => {
    expect(model.sources.map(sourceState)).toEqual(["answered", "failed", "not configured"]);
  });

  it("does not blame a missing API key for a keyless source with nothing to ask", () => {
    // GLEIF, reverse IP and the host-exposure scanners need no key. When a
    // lookup gives them nothing to work with (no resolved address, no
    // registrant organisation) the report must not say "not configured",
    // which would tell the reader a key was the missing piece.
    const noInput = { source: "GLEIF LEI", ok: false, skipped: true, error: "NO_INPUT" };
    expect(sourceState(noInput)).toBe("not applicable");
    const st = reportStats({ ...model, sources: [...model.sources, noInput] });
    expect(st).toMatchObject({ sourcesUnconfigured: 1, sourcesNotApplicable: 1 });
    expect(statsRows({ ...model, sources: [...model.sources, noInput] }))
      .toContainEqual({ label: "Not applicable", value: "1" });
    // And it stays off the stats table entirely when nothing was skipped that way.
    expect(statsRows(model).map((r) => r.label)).not.toContain("Not applicable");
  });

  it("gives each generated document its own id and control block", () => {
    const meta = reportMeta(model);
    expect(meta.documentId).toMatch(/^HGI-[0-9A-F]{10}$/);
    expect(meta.subjectType).toBe("Domain");
    // The id folds in the timestamp, so two runs are two documents.
    expect(reportMeta({ ...model, generatedAt: "2026-09-03T00:00:00.000Z" }).documentId).not.toBe(meta.documentId);
    expect(controlRows(model)).toContainEqual({ label: "Evidence basis", value: "3 sources queried, 1 answered, 2 recorded fields" });
  });

  it("drops statistics rows that would only ever read zero", () => {
    const labels = statsRows(noHeadline).map((r) => r.label);
    expect(labels).toContain("Sources queried");
    expect(labels).not.toContain("Failed");
    expect(labels).not.toContain("Pivot links");
    expect(statsRows(withAi).map((r) => r.label)).toContain("Flagged patterns");
  });

  it("falls back to a safe accent for an unknown or missing band", () => {
    expect(bandInk("critical")).toBe("#b00020");
    expect(bandInk("unknown-band")).toBe("#0a7a33");
    expect(bandInk(undefined)).toBe("#0a7a33");
    expect(bandNeon("high")).toBe("#ff9f43");
    expect(bandNeon("unknown-band")).toBe("#00ff85");
    expect(bandNeon(undefined)).toBe("#00ff85");
  });
});

describe("reportToText", () => {
  it("renders masthead, executive summary, sections, sources and pivots", () => {
    const t = reportToText(model);
    expect(t).toContain("Domain Intelligence Report");
    expect(t).toContain("CONTENTS");                 // numbered index
    expect(t).toContain("01. EXECUTIVE SUMMARY");    // first indexed section
    expect(t).toMatch(/Document ID\s+: HGI-/);
    expect(t).toContain("grade B");
    expect(t).toContain("• www.acme.test");
    // Three states, three words, and the reported error quoted under its row.
    expect(t).toContain("dns                          answered         30 ms");
    expect(t).toContain("whois                        failed");
    expect(t).toContain("reported: timeout");
    expect(t).toContain("hunter                       not configured");
    expect(t).toContain("crt.sh: https://crt.sh");
    expect(t).toContain("METHODOLOGY AND LIMITATIONS");
    expect(t).toContain("How to read the numbers:");
    expect(t).toContain("APPENDIX A: OBSERVABLES (STIX)");
    expect(t).toContain("domain-name");
    expect(t).toContain("APPENDIX B: COLLECTION STATISTICS");
    expect(t).toContain("Sources queried");
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
    expect(t).toContain("100%  Exposed service");
    expect(t).toContain("evidence: port 22 open");
    expect(t).toContain("Odd pairing (warn): hosting and residential");
    expect(t).toContain("ANALYST NARRATIVE");
    expect(t).toContain("acme.test scores 40 out of 100.");
  });
  it("renders a bare assessment without factors, patterns or narrative", () => {
    const t = reportToText(withCleanAi);
    expect(t).toContain("RISK ASSESSMENT");
    // The legend names both blocks, so match the block headers themselves.
    expect(t).not.toMatch(/^ {2}Contributing factors:$/m);
    expect(t).not.toMatch(/^ {2}Flagged patterns:$/m);
    expect(t).not.toContain("ANALYST NARRATIVE");
  });
});

describe("reportToMarkdown", () => {
  it("renders a table, list and escapes pipes", () => {
    const md = reportToMarkdown(model);
    expect(md).toContain("# HEAVEN-GeoIntel: Domain Intelligence Report");
    expect(md).toContain("| Document control | |");
    expect(md).toContain("## Contents");                            // index heading
    expect(md).toContain("- [06. Methodology and limitations](#06-methodology-and-limitations)");
    expect(md).toContain("## 06. Methodology and limitations");
    expect(md).toContain("| Field | Value |");
    expect(md).toContain("| MX | a \\| b |"); // pipe escaped
    expect(md).toContain("- www.acme.test");
    // A source table, not a row of emoji, and "skipped" says so in words.
    expect(md).toContain("| dns | answered | 30 ms |  |");
    expect(md).toContain("| whois | failed |  | timeout |");
    expect(md).toContain("| hunter | not configured |  |  |");
    expect(md).toContain("| `domain-name` | acme.test | `domain-name--");
    expect(md).toContain("- [crt.sh](https://crt.sh)");
    expect(md).toContain("## 08. Appendix B: collection statistics");
  });
  it("escapes a backslash before the pipe so a cell can't reopen a delimiter", () => {
    const m: ReportModel = { ...model, sections: [{ heading: "X", rows: [{ label: "L", value: "a\\|b" }] }] };
    const md = reportToMarkdown(m);
    expect(md).toContain("| L | a\\\\\\|b |");
  });
  it("omits the headline, sources, pivots and assessment when absent", () => {
    const md = reportToMarkdown(noHeadline);
    expect(md).not.toContain("HTTP headers");
    expect(md).not.toContain("Data sources");
    expect(md).not.toContain("Investigative pivots");
    expect(md).not.toContain("Risk assessment");
  });
  it("renders the executive summary, risk assessment and narrative when present", () => {
    const md = reportToMarkdown(withAi);
    expect(md).toContain("## 01. Executive summary");
    expect(md).toContain("## 02. Risk assessment");
    expect(md).toContain("- Score: 40/100 (elevated), confidence medium");
    expect(md).toContain("**Contributing factors**");
    expect(md).toContain("| Exposed service | 100% | port 22 open |");
    expect(md).toContain("| Odd pairing | warn | hosting and residential |");
    expect(md).toContain("Analyst narrative");
    expect(md).toContain("- acme.test scores 40 out of 100.");
  });
  it("renders a bare assessment without factors, patterns or narrative", () => {
    const md = reportToMarkdown(withCleanAi);
    expect(md).toContain("Risk assessment");
    expect(md).not.toContain("**Contributing factors**");
    expect(md).not.toContain("**Flagged patterns**");
    expect(md).not.toContain("Analyst narrative");
  });
});

describe("detUuid + reportToStixBundle", () => {
  it("detUuid is deterministic and UUID-shaped", () => {
    expect(detUuid("x")).toBe(detUuid("x"));
    expect(detUuid("x")).not.toBe(detUuid("y"));
    expect(detUuid("acme.test")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // The first implementation ran a 32-bit LCG through floating-point
  // multiplication, which threw away the low bits it then read. It emitted ids
  // like d8888888-8888-4888-8888-888888888888 and collided on 6% of 20,000
  // seeds: in a bundle, that is two unrelated observables sharing one id.
  it("detUuid spreads over the whole id space and does not collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(detUuid(`seed-${i}`));
    expect(seen.size).toBe(20_000);
    // No id may be one nibble repeated, the signature of the old generator.
    for (const seed of ["domain-name:github.com", "ipv4-addr:1.1.1.1", "HEAVEN-GeoIntel"]) {
      expect(detUuid(seed)).not.toMatch(/^(.)\1{7}-/);
    }
  });

  it("prints the same observable id a report shows and a bundle carries", () => {
    const bundle = reportToStixBundle(model) as { objects: { type: string; id: string }[] };
    const domain = bundle.objects.find((o) => o.type === "domain-name")!;
    expect(observableStixId({ type: "domain-name", value: "acme.test" })).toBe(domain.id);
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
