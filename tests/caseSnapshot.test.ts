import { describe, it, expect } from "vitest";
import {
  factsFromPhone, factsFromEmail, factsFromUsername, factsFromIp, factsFromDomain,
  diffFacts, diffSnapshot, appendSnapshot,
} from "@/lib/analysis/caseSnapshot";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, CaseSnapshot,
} from "@/lib/types";

const off = { ok: false as const, error: "NOT_CONFIGURED" };

const snap = (over: Partial<CaseSnapshot> = {}): CaseSnapshot => ({
  kind: "domain", value: "example.com", takenAt: 1000, facts: {}, ...over,
});

// ── summarisers ──────────────────────────────────────────────────────────────

describe("fact summarisers keep only what a source actually answered", () => {
  it("phone: omits every unconfigured source rather than recording a zero", () => {
    const facts = factsFromPhone({
      threatScore: 12, threatLabel: "LOW RISK",
      aggregated: { carrier: null, lineType: "mobile" },
      sources: { hudsonRock: off, leakCheck: off, breachDirectory: off },
    } as unknown as LookupResponse);
    // `carrier: null` and the three absent sources must NOT appear — "we don't
    // know" and "zero" are different claims, and a diff would treat them alike.
    expect(facts).toEqual({ threatScore: 12, threatLabel: "LOW RISK", lineType: "mobile" });
  });

  it("phone: records every source that answered", () => {
    const facts = factsFromPhone({
      threatScore: 70, threatLabel: "CRITICAL",
      aggregated: { carrier: "Jio", lineType: "mobile" },
      sources: {
        hudsonRock: { ok: true, data: { total: 2, stealers: [] } },
        leakCheck: { ok: true, data: { found: 9, fields: [], sources: [{ name: "a.com", date: null }] } },
        breachDirectory: { ok: true, data: { found: 3, fields: [], sources: [], results: [] } },
      },
    } as unknown as LookupResponse);
    expect(facts).toEqual({
      threatScore: 70, threatLabel: "CRITICAL", carrier: "Jio", lineType: "mobile",
      infostealerHits: 2, leakCheckRecords: 9, leakCheckBreaches: 1, breachCredentials: 3,
    });
  });

  it("email: summarises breach counts, gravatar presence and reputation", () => {
    const facts = factsFromEmail({
      analysis: { providerType: "free" },
      gravatar: { found: true },
      xon: { ok: true, data: { breachCount: 4 } },
      hudsonRock: { ok: true, data: { total: 1 } },
      leakCheck: { ok: true, data: { found: 12, sources: [{ name: "x" }, { name: "y" }] } },
      emailrep: { ok: true, data: { reputation: "high" } },
    } as unknown as EmailLookupResponse);
    expect(facts).toEqual({
      breaches: 4, infostealerHits: 1, leakCheckRecords: 12, leakCheckBreaches: 2,
      gravatar: "present", reputation: "high", providerType: "free",
    });
  });

  it("email: reports an absent gravatar as 'none', not as a missing fact", () => {
    const facts = factsFromEmail({
      analysis: { providerType: "corporate" }, gravatar: { found: false },
      xon: off, hudsonRock: off, leakCheck: off, emailrep: off,
    } as unknown as EmailLookupResponse);
    expect(facts).toEqual({ gravatar: "none", providerType: "corporate" });
  });

  it("username: counts sites and verified profiles", () => {
    expect(factsFromUsername({
      found: 13, checked: 24, profiles: [{}, {}],
      leakCheck: { ok: true, data: { found: 54 } },
    } as unknown as UsernameLookupResponse)).toEqual({
      sitesFound: 13, sitesChecked: 24, verifiedProfiles: 2, leakCheckRecords: 54,
    });
  });

  it("ip: records ASN, exposure and GreyNoise classification", () => {
    expect(factsFromIp({
      threatScore: 0,
      ip: {
        asn: 15169, asnOrg: "GOOGLE", countryCode: "US", reverse: "dns.google",
        ports: [53, 443], vulns: [], greyNoise: { classification: "benign" },
      },
    } as unknown as IpLookupResponse)).toEqual({
      threatScore: 0, asn: 15169, asnOrg: "GOOGLE", country: "US",
      reverse: "dns.google", openPorts: 2, knownVulns: 0, greyNoise: "benign",
    });
  });

  it("ip: keeps only the score when the lookup produced no ip block", () => {
    expect(factsFromIp({ threatScore: 5, ip: null } as unknown as IpLookupResponse)).toEqual({ threatScore: 5 });
  });

  it("domain: records record counts, registrar and posture", () => {
    expect(factsFromDomain({
      dns: { a: [{}], mx: [{}, {}], ns: [{}] },
      subdomains: ["a", "b", "c"],
      whois: { registrar: "MarkMonitor", expiresDate: "2027-01-01" },
      emailSecurity: { hasSpf: true, dmarcPolicy: "reject" },
      dnssec: true,
    } as unknown as DomainLookupResponse)).toEqual({
      aRecords: 1, mxRecords: 2, nsRecords: 1, subdomains: 3,
      registrar: "MarkMonitor", expires: "2027-01-01", spf: "present",
      dmarcPolicy: "reject", dnssec: "signed",
    });
  });

  it("domain: distinguishes unsigned from undeterminable DNSSEC", () => {
    const base = {
      dns: { a: [], mx: [], ns: [] }, subdomains: [], whois: null,
      emailSecurity: { hasSpf: false, dmarcPolicy: null },
    };
    expect(factsFromDomain({ ...base, dnssec: false } as unknown as DomainLookupResponse).dnssec).toBe("unsigned");
    // null = we could not determine it, so the fact is omitted entirely rather
    // than asserting the domain is unsigned.
    expect(factsFromDomain({ ...base, dnssec: null } as unknown as DomainLookupResponse).dnssec).toBeUndefined();
  });
});

// ── diffing ──────────────────────────────────────────────────────────────────

describe("diffFacts", () => {
  it("reports values that changed, appeared and disappeared", () => {
    expect(diffFacts({ a: 1, gone: "x" }, { a: 2, added: "y" })).toEqual([
      { fact: "a", from: 1, to: 2 },
      { fact: "added", from: null, to: "y" },
      { fact: "gone", from: "x", to: null },
    ]);
  });

  it("returns nothing when the bags match", () => {
    expect(diffFacts({ a: 1, b: "x" }, { b: "x", a: 1 })).toEqual([]);
  });
});

describe("diffSnapshot", () => {
  it("marks the first snapshot as a baseline, not as 'no change'", () => {
    const d = diffSnapshot([], snap({ takenAt: 5, facts: { subdomains: 3 } }));
    expect(d.baseline).toBe(true);
    expect(d.previousAt).toBeNull();
    expect(d.changes).toEqual([]);
  });

  it("compares against the most recent snapshot of the SAME identifier", () => {
    const history = [
      snap({ takenAt: 1, facts: { subdomains: 1 } }),
      snap({ value: "other.com", takenAt: 2, facts: { subdomains: 99 } }),
      snap({ takenAt: 3, facts: { subdomains: 4 } }),
    ];
    const d = diffSnapshot(history, snap({ takenAt: 4, facts: { subdomains: 7 } }));
    expect(d.previousAt).toBe(3);
    expect(d.baseline).toBe(false);
    expect(d.changes).toEqual([{ fact: "subdomains", from: 4, to: 7 }]);
  });

  it("matches identifiers case-insensitively", () => {
    const d = diffSnapshot([snap({ value: "EXAMPLE.com", takenAt: 1, facts: { a: 1 } })],
                           snap({ value: "example.com", takenAt: 2, facts: { a: 2 } }));
    expect(d.baseline).toBe(false);
  });

  it("flags when either side came from the result cache", () => {
    expect(diffSnapshot([], snap({ fromCache: true })).cacheInvolved).toBe(true);
    expect(diffSnapshot([snap({ takenAt: 1, fromCache: true })], snap({ takenAt: 2 })).cacheInvolved).toBe(true);
    expect(diffSnapshot([snap({ takenAt: 1 })], snap({ takenAt: 2 })).cacheInvolved).toBe(false);
  });
});

describe("appendSnapshot", () => {
  it("drops the oldest entry for that identifier once the cap is reached", () => {
    let history: CaseSnapshot[] = [];
    for (let t = 1; t <= 5; t++) history = appendSnapshot(history, snap({ takenAt: t }), 3);
    expect(history.map((s) => s.takenAt)).toEqual([3, 4, 5]);
  });

  it("never evicts a different identifier's history", () => {
    let history: CaseSnapshot[] = [snap({ value: "keep.com", takenAt: 1 })];
    for (let t = 2; t <= 5; t++) history = appendSnapshot(history, snap({ takenAt: t }), 2);
    expect(history.filter((s) => s.value === "keep.com")).toHaveLength(1);
    expect(history.filter((s) => s.value === "example.com").map((s) => s.takenAt)).toEqual([4, 5]);
  });

  it("keeps everything while under the cap", () => {
    const history = appendSnapshot([snap({ takenAt: 1 })], snap({ takenAt: 2 }), 5);
    expect(history.map((s) => s.takenAt)).toEqual([1, 2]);
  });
});
