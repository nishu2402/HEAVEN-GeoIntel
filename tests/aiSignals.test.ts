import { describe, it, expect } from "vitest";
import {
  signalsFromEmail, signalsFromPhone, signalsFromUsername, signalsFromIp,
  signalsFromDomain, signalsFromWallet, signalsFromHash, type Signal,
} from "@/lib/ai/signals";
import type {
  EmailLookupResponse, LookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
  BreachAggregate, CredentialExposure,
} from "@/lib/types";

// Every extractor is exercised branch by branch. The one rule under test is the
// same one the module promises: a signal appears only when a real field carries
// it, and an informational (intensity 0) fact still surfaces for display.

const id = (s: Signal[], sid: string) => s.find((x) => x.id === sid);
const ids = (s: Signal[]) => s.map((x) => x.id);

const agg = (over: Partial<BreachAggregate> = {}): BreachAggregate => ({
  breaches: [], total: 0, sourcesReporting: [], sourcesAnswered: [],
  withPassword: 0, verified: 0, dataClasses: [], firstBreach: null, lastBreach: null,
  timeline: [], enrichedCount: 0, passwordFieldsSeen: false, ...over,
});
const cx = (over: Partial<CredentialExposure> = {}): CredentialExposure => ({
  distinctPasswords: 0, pairs: 0, capped: false, samples: [], passwordBreaches: 0,
  stealerLogs: 0, stealerPasswords: 0, exposed: false, reuse: "none", ...over,
});

const email = (over: Record<string, unknown> = {}): EmailLookupResponse => ({
  email: "ada@example.com",
  analysis: { domain: "example.com", providerName: "Example", isDisposable: false, isRoleAddress: false },
  emailrep: { ok: false },
  ...over,
} as unknown as EmailLookupResponse);

// ── credential signals (shared, driven through email) ────────────────────────

describe("credential + breach signals", () => {
  it("emits a breach count that pluralises and names its sources", () => {
    const one = signalsFromEmail(email({ breachAggregate: agg({ total: 1, sourcesReporting: ["XposedOrNot"] }) }));
    expect(id(one, "breach.count")!.evidence).toBe("1 breach reported by XposedOrNot");
    const many = signalsFromEmail(email({ breachAggregate: agg({ total: 4, sourcesReporting: ["XposedOrNot", "LeakCheck"] }) }));
    expect(id(many, "breach.count")!.evidence).toBe("4 breaches reported by XposedOrNot, LeakCheck");
    expect(id(many, "breach.count")!.intensity).toBeCloseTo(0.5);
    // a large count saturates the ramp at full intensity
    expect(id(signalsFromEmail(email({ breachAggregate: agg({ total: 20, sourcesReporting: ["X"] }) })), "breach.count")!.intensity).toBe(1);
  });

  it("emits password exposure from counted breaches", () => {
    const s = signalsFromEmail(email({ breachAggregate: agg({ total: 2, withPassword: 1 }) }));
    expect(id(s, "breach.password")!.evidence).toBe("1 breach exposed a password");
    const s2 = signalsFromEmail(email({ breachAggregate: agg({ total: 3, withPassword: 2 }) }));
    expect(id(s2, "breach.password")!.evidence).toBe("2 breaches exposed a password");
  });

  it("emits password exposure from a set-level field with no per-breach count", () => {
    const s = signalsFromEmail(email({ breachAggregate: agg({ total: 1, withPassword: 0, passwordFieldsSeen: true }) }));
    const p = id(s, "breach.password")!;
    expect(p.intensity).toBe(0.4);
    expect(p.evidence).toBe("password fields appear in the breach set");
  });

  it("emits plaintext, stealer and reuse signals, pluralising each", () => {
    const s = signalsFromEmail(email({ credentialExposure: cx({ distinctPasswords: 1, stealerLogs: 1, reuse: "likely" }) }));
    expect(id(s, "credential.plaintext")!.evidence).toBe("1 distinct password seen in credential dumps");
    expect(id(s, "malware.stealer")!.evidence).toBe("1 infostealer log captured a credential");
    expect(id(s, "credential.reuse")).toBeTruthy();
    const s2 = signalsFromEmail(email({ credentialExposure: cx({ distinctPasswords: 3, stealerLogs: 2 }) }));
    expect(id(s2, "credential.plaintext")!.evidence).toBe("3 distinct passwords seen in credential dumps");
    expect(id(s2, "malware.stealer")!.evidence).toBe("2 infostealer logs captured a credential");
  });

  it("emits nothing from an empty or absent breach/credential picture", () => {
    expect(signalsFromEmail(email())).toEqual([]);
    expect(signalsFromEmail(email({ breachAggregate: agg({ total: 0 }), credentialExposure: cx({ reuse: "exposed" }) }))).toEqual([]);
  });
});

// ── email-specific ────────────────────────────────────────────────────────────

describe("signalsFromEmail", () => {
  const rep = (over: Record<string, unknown>) => ({ ok: true, data: { maliciousActivity: false, blacklisted: false, suspicious: false, ...over } });

  it("grades reputation flags malicious > blacklisted > suspicious", () => {
    expect(id(signalsFromEmail(email({ emailrep: rep({ maliciousActivity: true }) })), "reputation.malicious")!.intensity).toBe(0.8);
    expect(id(signalsFromEmail(email({ emailrep: rep({ blacklisted: true }) })), "reputation.malicious")!.intensity).toBe(0.6);
    expect(id(signalsFromEmail(email({ emailrep: rep({ suspicious: true }) })), "reputation.malicious")!.intensity).toBe(0.35);
  });

  it("emits no reputation signal when the source is clean, failed, or dataless", () => {
    expect(id(signalsFromEmail(email({ emailrep: rep({}) })), "reputation.malicious")).toBeUndefined();
    expect(id(signalsFromEmail(email({ emailrep: { ok: false } })), "reputation.malicious")).toBeUndefined();
    expect(id(signalsFromEmail(email({ emailrep: { ok: true } })), "reputation.malicious")).toBeUndefined();
  });

  it("names disposable providers, falling back to the domain when unnamed", () => {
    expect(id(signalsFromEmail(email({ analysis: { domain: "mailinator.com", providerName: "Mailinator", isDisposable: true, isRoleAddress: false } })), "hygiene.disposable")!.evidence).toContain("Mailinator");
    expect(id(signalsFromEmail(email({ analysis: { domain: "mailinator.com", providerName: "", isDisposable: true, isRoleAddress: false } })), "hygiene.disposable")!.evidence).toContain("mailinator.com");
  });

  it("flags a role address", () => {
    expect(id(signalsFromEmail(email({ analysis: { domain: "x.com", providerName: "X", isDisposable: false, isRoleAddress: true } })), "hygiene.role")).toBeTruthy();
  });
});

// ── phone-specific ────────────────────────────────────────────────────────────

describe("signalsFromPhone", () => {
  const phone = (over: Record<string, unknown> = {}): LookupResponse => ({
    input: { e164: "+14155552671" },
    analysis: { e164: "+14155552671", isPremiumRate: false, isVoip: false },
    offline: { confidence: "high" },
    ...over,
  } as unknown as LookupResponse);

  it("flags premium-rate and VoIP lines and low-confidence lines", () => {
    expect(id(signalsFromPhone(phone({ analysis: { e164: "x", isPremiumRate: true, isVoip: false } })), "hygiene.premium")).toBeTruthy();
    expect(id(signalsFromPhone(phone({ analysis: { e164: "x", isPremiumRate: false, isVoip: true } })), "hygiene.voip")).toBeTruthy();
    const low = signalsFromPhone(phone({ offline: { confidence: "low" } }));
    expect(id(low, "hygiene.unconfirmed")!.intensity).toBe(0);
  });

  it("reuses the shared breach signals", () => {
    expect(id(signalsFromPhone(phone({ breachAggregate: agg({ total: 2, sourcesReporting: ["LeakCheck"] }) })), "breach.count")).toBeTruthy();
  });

  it("is empty for a clean, confident, ordinary line", () => {
    expect(signalsFromPhone(phone())).toEqual([]);
  });
});

// ── username-specific ─────────────────────────────────────────────────────────

describe("signalsFromUsername", () => {
  const uname = (over: Record<string, unknown> = {}): UsernameLookupResponse => ({
    username: "ada", found: 0,
    identity: { names: [], locations: [], avatars: [], bios: [] },
    ...over,
  } as unknown as UsernameLookupResponse);

  it("resolves identity only when a name spans two or more profiles", () => {
    const two = signalsFromUsername(uname({ identity: { names: [{ value: "Ada", source: "GitHub" }, { value: "Ada", source: "Reddit" }], locations: [], avatars: [], bios: [] } }));
    expect(id(two, "identity.resolved")!.evidence).toContain("2 confirmed profiles");
    const one = signalsFromUsername(uname({ identity: { names: [{ value: "Ada", source: "GitHub" }], locations: [], avatars: [], bios: [] } }));
    expect(id(one, "identity.resolved")).toBeUndefined();
  });

  it("scores the public account footprint, pluralising", () => {
    expect(id(signalsFromUsername(uname({ found: 1 })), "footprint.accounts")!.evidence).toBe("1 confirmed account across checked sites");
    expect(id(signalsFromUsername(uname({ found: 3 })), "footprint.accounts")!.evidence).toBe("3 confirmed accounts across checked sites");
    expect(id(signalsFromUsername(uname({ found: 0 })), "footprint.accounts")).toBeUndefined();
  });
});

// ── IP-specific ───────────────────────────────────────────────────────────────

describe("signalsFromIp", () => {
  const base = { isTor: false, isProxy: false, isVpn: false, isHosting: false, greyNoise: null, tags: null, vulns: null, ports: null };
  const ipr = (ipOver: Record<string, unknown> | null, over: Record<string, unknown> = {}): IpLookupResponse => ({
    input: "8.8.8.8", ip: ipOver === null ? null : { ...base, ...ipOver }, ...over,
  } as unknown as IpLookupResponse);

  it("returns nothing when the address did not resolve", () => {
    expect(signalsFromIp(ipr(null))).toEqual([]);
  });

  it("classifies Tor over anonymiser over nothing", () => {
    expect(id(signalsFromIp(ipr({ isTor: true, isProxy: true })), "network.tor")).toBeTruthy();
    expect(id(signalsFromIp(ipr({ isProxy: true })), "network.anonymizer")!.evidence).toContain("proxy");
    expect(id(signalsFromIp(ipr({ isVpn: true })), "network.anonymizer")!.evidence).toContain("VPN");
    expect(ids(signalsFromIp(ipr({})))).toEqual([]);
  });

  it("flags hosting", () => {
    expect(id(signalsFromIp(ipr({ isHosting: true })), "network.hosting")).toBeTruthy();
  });

  it("maps GreyNoise malicious, noise, and benign RIOT", () => {
    expect(id(signalsFromIp(ipr({ greyNoise: { classification: "malicious", noise: true, riot: false, name: "Mirai", lastSeen: null } })), "network.scanner")!.evidence).toContain("Mirai");
    expect(id(signalsFromIp(ipr({ greyNoise: { classification: "malicious", noise: false, riot: false, name: null, lastSeen: null } })), "network.scanner")!.evidence).toBe("GreyNoise classifies the address malicious");
    expect(id(signalsFromIp(ipr({ greyNoise: { classification: "unknown", noise: true, riot: false, name: null, lastSeen: null } })), "network.noise")).toBeTruthy();
    expect(id(signalsFromIp(ipr({ greyNoise: { classification: "benign", noise: false, riot: true, name: null, lastSeen: null } })), "network.benign")!.intensity).toBe(0);
    expect(ids(signalsFromIp(ipr({ greyNoise: { classification: "benign", noise: false, riot: false, name: null, lastSeen: null } })))).toEqual([]);
  });

  it("flags compromised tags, CVEs and open ports (and ignores empty/null lists)", () => {
    expect(id(signalsFromIp(ipr({ tags: ["cdn", "compromised"] })), "exposure.compromised")).toBeTruthy();
    expect(ids(signalsFromIp(ipr({ tags: ["cdn"] })))).toEqual([]);
    expect(id(signalsFromIp(ipr({ vulns: ["CVE-1"] })), "exposure.vulns")!.evidence).toContain("1 CVE observed: CVE-1");
    expect(id(signalsFromIp(ipr({ vulns: ["CVE-1", "CVE-2", "CVE-3", "CVE-4", "CVE-5"] })), "exposure.vulns")!.evidence).toContain("5 CVEs observed: CVE-1, CVE-2, CVE-3, CVE-4");
    expect(ids(signalsFromIp(ipr({ vulns: [] })))).toEqual([]);
    expect(id(signalsFromIp(ipr({ ports: [22] })), "exposure.ports")!.evidence).toBe("1 open port: 22");
    expect(id(signalsFromIp(ipr({ ports: [22, 80] })), "exposure.ports")!.evidence).toBe("2 open ports: 22, 80");
    expect(ids(signalsFromIp(ipr({ ports: [] })))).toEqual([]);
  });

  it("marks a non-routable scope as informational and skips routable/absent classification", () => {
    expect(id(signalsFromIp(ipr({}, { classification: { label: "Private (RFC 1918)", isGloballyRoutable: false } })), "network.nonroutable")!.intensity).toBe(0);
    expect(ids(signalsFromIp(ipr({}, { classification: { label: "Global", isGloballyRoutable: true } })))).toEqual([]);
    expect(ids(signalsFromIp(ipr({})))).toEqual([]);
  });
});

// ── domain-specific ───────────────────────────────────────────────────────────

describe("signalsFromDomain", () => {
  const dom = (over: Record<string, unknown> = {}): DomainLookupResponse => ({
    domain: "example.com",
    emailSecurity: { hasMx: false, hasDmarc: false },
    http: null, dnssec: null,
    ...over,
  } as unknown as DomainLookupResponse);
  const http = (tls: Record<string, unknown> | null, grade = "A", percent = 90) => ({ tls, security: { grade, percent } });

  it("flags expired TLS with a pluralised age", () => {
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: -1, trusted: true, trustError: null }) })), "infra.tls_expired")!.evidence).toBe("certificate expired 1 day ago");
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: -3, trusted: true, trustError: null }) })), "infra.tls_expired")!.evidence).toBe("certificate expired 3 days ago");
  });

  it("flags an untrusted chain, using the trust error or a fallback", () => {
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: false, trustError: "self signed certificate" }) })), "infra.tls_untrusted")!.evidence).toBe("self signed certificate");
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: null, trusted: false, trustError: null }) })), "infra.tls_untrusted")!.evidence).toContain("did not validate");
  });

  it("does not flag TLS when trusted and current, or when there is no probe/cert", () => {
    expect(ids(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: true, trustError: null }) })))).toEqual([]);
    expect(ids(signalsFromDomain(dom({ http: null })))).toEqual([]);
    expect(ids(signalsFromDomain(dom({ http: http(null) })))).toEqual([]);
  });

  it("grades weak security headers F/D/C and ignores A/B", () => {
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: true, trustError: null }, "F", 10) })), "infra.security_grade")!.intensity).toBe(0.6);
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: true, trustError: null }, "D", 30) })), "infra.security_grade")!.intensity).toBe(0.45);
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: true, trustError: null }, "C", 55) })), "infra.security_grade")!.intensity).toBe(0.25);
    expect(id(signalsFromDomain(dom({ http: http({ daysRemaining: 30, trusted: true, trustError: null }, "B", 75) })), "infra.security_grade")).toBeUndefined();
  });

  it("flags a mail domain without DMARC, and not otherwise", () => {
    expect(id(signalsFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: false } })), "infra.no_dmarc")).toBeTruthy();
    expect(id(signalsFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: true } })), "infra.no_dmarc")).toBeUndefined();
    expect(id(signalsFromDomain(dom({ emailSecurity: { hasMx: false, hasDmarc: false } })), "infra.no_dmarc")).toBeUndefined();
    // null = the DNS query got no answer, which is not a missing DMARC.
    expect(id(signalsFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: null } })), "infra.no_dmarc")).toBeUndefined();
    expect(id(signalsFromDomain(dom({ emailSecurity: { hasMx: null, hasDmarc: false } })), "infra.no_dmarc")).toBeUndefined();
  });

  it("flags takeover candidates, catalogued breaches, and disabled DNSSEC", () => {
    expect(id(signalsFromDomain(dom({ takeoverCandidates: [{ name: "a" }] })), "infra.takeover")!.evidence).toContain("1 dangling record");
    expect(id(signalsFromDomain(dom({ takeoverCandidates: [{ name: "a" }, { name: "b" }] })), "infra.takeover")!.evidence).toContain("2 dangling records");
    expect(ids(signalsFromDomain(dom({ takeoverCandidates: [] })))).toEqual([]);
    expect(id(signalsFromDomain(dom({ knownBreaches: [{ name: "x" }] })), "breach.domain")!.evidence).toContain("1 catalogued breach");
    expect(id(signalsFromDomain(dom({ knownBreaches: [{ name: "x" }, { name: "y" }] })), "breach.domain")!.evidence).toContain("2 catalogued breaches");
    expect(id(signalsFromDomain(dom({ dnssec: false })), "infra.dnssec_off")!.intensity).toBe(0);
    expect(ids(signalsFromDomain(dom({ dnssec: true })))).toEqual([]);
  });
});

// ── wallet + hash ─────────────────────────────────────────────────────────────

describe("signalsFromWallet", () => {
  const wal = (facts: Record<string, unknown> | null): WalletLookupResponse => ({ input: "0xabc", facts } as unknown as WalletLookupResponse);

  it("returns nothing without facts", () => {
    expect(signalsFromWallet(wal(null))).toEqual([]);
  });

  it("emits informational activity and balance signals only", () => {
    const s = signalsFromWallet(wal({ chain: "ethereum", balance: "1.5 ETH", balanceRaw: "1500000000000000000", txCount: 1 }));
    expect(id(s, "wallet.active")!.evidence).toBe("1 transaction on ethereum");
    expect(id(s, "wallet.balance")!.evidence).toBe("balance 1.5 ETH");
    expect(s.every((x) => x.intensity === 0)).toBe(true);
    const many = signalsFromWallet(wal({ chain: "bitcoin", balance: "0 BTC", balanceRaw: "0", txCount: 4 }));
    expect(id(many, "wallet.active")!.evidence).toBe("4 transactions on bitcoin");
    expect(id(many, "wallet.balance")).toBeUndefined();
  });

  it("skips activity when there are no or null transactions", () => {
    expect(ids(signalsFromWallet(wal({ chain: "ethereum", balance: "0 ETH", balanceRaw: "0", txCount: 0 })))).toEqual([]);
    expect(ids(signalsFromWallet(wal({ chain: "ethereum", balance: "0 ETH", balanceRaw: "0", txCount: null })))).toEqual([]);
  });
});

describe("signalsFromHash", () => {
  const hsh = (facts: Record<string, unknown> | null): HashLookupResponse => ({ input: "abc", facts } as unknown as HashLookupResponse);

  it("returns nothing without facts", () => {
    expect(signalsFromHash(hsh(null))).toEqual([]);
  });

  it("flags a known-but-low-trust file, using the source or a fallback", () => {
    expect(id(signalsFromHash(hsh({ known: true, trust: 20, source: "NSRL" })), "hash.lowtrust")!.evidence).toContain("NSRL");
    expect(id(signalsFromHash(hsh({ known: true, trust: 10, source: null })), "hash.lowtrust")!.evidence).toContain("a known-software database");
  });

  it("marks a known-good file (high or unknown trust) as informational", () => {
    expect(id(signalsFromHash(hsh({ known: true, trust: 80, source: "NSRL", productName: "Windows" })), "hash.knowngood")!.evidence).toContain("(Windows)");
    expect(id(signalsFromHash(hsh({ known: true, trust: null, source: null, productName: null })), "hash.knowngood")!.evidence).toBe("matched in a known-software database");
  });

  it("marks an unknown file as neutral, not malicious", () => {
    expect(id(signalsFromHash(hsh({ known: false })), "hash.unknown")!.intensity).toBe(0);
  });
});
