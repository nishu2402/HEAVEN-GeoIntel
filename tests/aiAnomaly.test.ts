import { describe, it, expect } from "vitest";
import {
  anomaliesFromEmail, anomaliesFromPhone, anomaliesFromUsername,
  anomaliesFromIp, anomaliesFromDomain, type Anomaly,
} from "@/lib/ai/anomaly";
import type {
  EmailLookupResponse, LookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, BreachAggregate, CredentialExposure,
} from "@/lib/types";

const has = (a: Anomaly[], id: string) => a.some((x) => x.id === id);

const agg = (over: Partial<BreachAggregate> = {}): BreachAggregate => ({
  breaches: [], total: 0, sourcesReporting: [], sourcesAnswered: [],
  withPassword: 0, verified: 0, dataClasses: [], firstBreach: null, lastBreach: null,
  timeline: [], enrichedCount: 0, passwordFieldsSeen: false, ...over,
});
const cx = (over: Partial<CredentialExposure> = {}): CredentialExposure => ({
  distinctPasswords: 0, pairs: 0, capped: false, samples: [], passwordBreaches: 0,
  stealerLogs: 0, stealerPasswords: 0, exposed: false, reuse: "none", ...over,
});

// ── shared credential combinations, driven through phone (pure credCombo) ─────

describe("credential-combination anomalies", () => {
  const phone = (over: Record<string, unknown>): LookupResponse => (over as unknown as LookupResponse);

  it("flags a stealer + breached-password combination as critical", () => {
    // password proven by cx's own count
    expect(has(anomaliesFromPhone(phone({ credentialExposure: cx({ stealerLogs: 1, passwordBreaches: 2 }) })), "combo.stealer_breach")).toBe(true);
    // password proven by the union instead
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 1 }), credentialExposure: cx({ stealerLogs: 1 }) })), "combo.stealer_breach")).toBe(true);
  });

  it("does not flag the stealer combo without a breached password", () => {
    // stealer present, but no password evidence anywhere (cx count 0, no agg)
    expect(has(anomaliesFromPhone(phone({ credentialExposure: cx({ stealerLogs: 1 }) })), "combo.stealer_breach")).toBe(false);
    // stealer present, agg present but withPassword 0
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 0 }), credentialExposure: cx({ stealerLogs: 1 }) })), "combo.stealer_breach")).toBe(false);
    // no stealer at all
    expect(has(anomaliesFromPhone(phone({ credentialExposure: cx({ stealerLogs: 0, passwordBreaches: 3 }) })), "combo.stealer_breach")).toBe(false);
    // no credential exposure object at all
    expect(anomaliesFromPhone(phone({}))).toEqual([]);
  });

  it("flags a reused, breached password as high, guarding each side", () => {
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 1 }), credentialExposure: cx({ reuse: "likely" }) })), "combo.reuse_plaintext")).toBe(true);
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 0 }), credentialExposure: cx({ reuse: "likely" }) })), "combo.reuse_plaintext")).toBe(false);
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 1 }), credentialExposure: cx({ reuse: "none" }) })), "combo.reuse_plaintext")).toBe(false);
    expect(has(anomaliesFromPhone(phone({ breachAggregate: agg({ withPassword: 1 }) })), "combo.reuse_plaintext")).toBe(false);
  });
});

// ── email ─────────────────────────────────────────────────────────────────────

describe("anomaliesFromEmail", () => {
  const email = (over: Record<string, unknown>): EmailLookupResponse => ({ emailrep: { ok: false }, ...over } as unknown as EmailLookupResponse);
  const malicious = { ok: true, data: { maliciousActivity: true } };

  it("flags malicious + breach-exposed", () => {
    expect(has(anomaliesFromEmail(email({ emailrep: malicious, breachAggregate: agg({ total: 2 }) })), "combo.malicious_breach")).toBe(true);
  });

  it("does not flag when malicious but unbreached, clean, or dataless", () => {
    expect(has(anomaliesFromEmail(email({ emailrep: malicious, breachAggregate: agg({ total: 0 }) })), "combo.malicious_breach")).toBe(false);
    expect(has(anomaliesFromEmail(email({ emailrep: malicious })), "combo.malicious_breach")).toBe(false); // no breachAggregate -> total 0
    expect(has(anomaliesFromEmail(email({ emailrep: { ok: true, data: { maliciousActivity: false } }, breachAggregate: agg({ total: 2 }) })), "combo.malicious_breach")).toBe(false);
    expect(has(anomaliesFromEmail(email({ emailrep: { ok: false }, breachAggregate: agg({ total: 2 }) })), "combo.malicious_breach")).toBe(false);
  });
});

// ── username ──────────────────────────────────────────────────────────────────

describe("anomaliesFromUsername", () => {
  const uname = (names: { value: string; source: string }[], over: Record<string, unknown> = {}): UsernameLookupResponse => ({
    identity: { names, locations: [], avatars: [], bios: [] }, ...over,
  } as unknown as UsernameLookupResponse);

  it("flags a resolvable identity that is also breach-exposed", () => {
    const names = [{ value: "Ada", source: "GitHub" }, { value: "Ada", source: "Reddit" }];
    expect(has(anomaliesFromUsername(uname(names, { breachAggregate: agg({ total: 1 }) })), "combo.identity_breach")).toBe(true);
    expect(has(anomaliesFromUsername(uname(names, { breachAggregate: agg({ total: 0 }) })), "combo.identity_breach")).toBe(false);
    expect(has(anomaliesFromUsername(uname(names)), "combo.identity_breach")).toBe(false); // no breachAggregate
    expect(has(anomaliesFromUsername(uname([{ value: "Ada", source: "GitHub" }], { breachAggregate: agg({ total: 1 }) })), "combo.identity_breach")).toBe(false);
  });
});

// ── IP ─────────────────────────────────────────────────────────────────────────

describe("anomaliesFromIp", () => {
  const ipr = (ip: Record<string, unknown> | null): IpLookupResponse => ({ input: "1.2.3.4", ip } as unknown as IpLookupResponse);

  it("returns nothing without a resolved address", () => {
    expect(anomaliesFromIp(ipr(null))).toEqual([]);
  });

  it("flags exposed services carrying CVEs, singular and plural", () => {
    expect(anomaliesFromIp(ipr({ ports: [80], vulns: ["CVE-1"], greyNoise: null })).find((a) => a.id === "combo.exposed_cve")!.detail).toContain("1 known vulnerability");
    expect(anomaliesFromIp(ipr({ ports: [80], vulns: ["CVE-1", "CVE-2"], greyNoise: null })).find((a) => a.id === "combo.exposed_cve")!.detail).toContain("2 known vulnerabilities");
  });

  it("does not flag CVEs without open ports or without vulns", () => {
    expect(has(anomaliesFromIp(ipr({ ports: null, vulns: ["CVE-1"], greyNoise: null })), "combo.exposed_cve")).toBe(false);
    expect(has(anomaliesFromIp(ipr({ ports: [80], vulns: null, greyNoise: null })), "combo.exposed_cve")).toBe(false);
    expect(has(anomaliesFromIp(ipr({ ports: [80], vulns: [], greyNoise: null })), "combo.exposed_cve")).toBe(false);
  });

  it("flags a malicious scanner that also exposes services", () => {
    expect(has(anomaliesFromIp(ipr({ ports: [80], vulns: null, greyNoise: { classification: "malicious" } })), "combo.malicious_scanner")).toBe(true);
    expect(has(anomaliesFromIp(ipr({ ports: [80], vulns: null, greyNoise: { classification: "benign" } })), "combo.malicious_scanner")).toBe(false);
    expect(has(anomaliesFromIp(ipr({ ports: [80], vulns: null, greyNoise: null })), "combo.malicious_scanner")).toBe(false);
  });
});

// ── domain ───────────────────────────────────────────────────────────────────

describe("anomaliesFromDomain", () => {
  const dom = (over: Record<string, unknown>): DomainLookupResponse => ({
    emailSecurity: { hasMx: false, hasDmarc: false }, http: null, ...over,
  } as unknown as DomainLookupResponse);

  it("flags takeover candidates, singular and plural", () => {
    expect(anomaliesFromDomain(dom({ takeoverCandidates: [{ name: "a" }] })).find((a) => a.id === "domain.takeover")!.detail).toContain("record points");
    expect(anomaliesFromDomain(dom({ takeoverCandidates: [{ name: "a" }, { name: "b" }] })).find((a) => a.id === "domain.takeover")!.detail).toContain("records point");
    expect(has(anomaliesFromDomain(dom({ takeoverCandidates: [] })), "domain.takeover")).toBe(false);
    expect(has(anomaliesFromDomain(dom({})), "domain.takeover")).toBe(false);
  });

  it("flags an expired live certificate only when one is served and dated", () => {
    expect(has(anomaliesFromDomain(dom({ http: { tls: { daysRemaining: -1 } } })), "domain.tls_expired")).toBe(true);
    expect(has(anomaliesFromDomain(dom({ http: { tls: { daysRemaining: 5 } } })), "domain.tls_expired")).toBe(false);
    expect(has(anomaliesFromDomain(dom({ http: { tls: { daysRemaining: null } } })), "domain.tls_expired")).toBe(false);
    expect(has(anomaliesFromDomain(dom({ http: { tls: null } })), "domain.tls_expired")).toBe(false);
    expect(has(anomaliesFromDomain(dom({ http: null })), "domain.tls_expired")).toBe(false);
  });

  it("flags a spoofable mail domain (MX, no DMARC)", () => {
    expect(has(anomaliesFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: false } })), "domain.spoofable")).toBe(true);
    expect(has(anomaliesFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: true } })), "domain.spoofable")).toBe(false);
    expect(has(anomaliesFromDomain(dom({ emailSecurity: { hasMx: false, hasDmarc: false } })), "domain.spoofable")).toBe(false);
    // null = the DNS query got no answer: an unknown is not evidence of spoofing.
    expect(has(anomaliesFromDomain(dom({ emailSecurity: { hasMx: true, hasDmarc: null } })), "domain.spoofable")).toBe(false);
    expect(has(anomaliesFromDomain(dom({ emailSecurity: { hasMx: null, hasDmarc: false } })), "domain.spoofable")).toBe(false);
  });
});
