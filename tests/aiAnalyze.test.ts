import { describe, it, expect } from "vitest";
import { analyzeLookup } from "@/lib/ai";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse,
  IpLookupResponse, DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
} from "@/lib/types";

// The orchestrator dispatches every mode, picks the right subject, and always
// returns a scored, narrated bundle. One rich case proves the whole pipeline
// (signals -> risk -> anomalies -> summary) fuses correctly.

describe("analyzeLookup dispatch", () => {
  it("analyses a phone lookup", () => {
    const data = { analysis: { e164: "+14155552671", isPremiumRate: false, isVoip: false }, offline: { confidence: "high" } } as unknown as LookupResponse;
    const a = analyzeLookup({ kind: "phone", data });
    expect(a.kind).toBe("phone");
    expect(a.subject).toBe("+14155552671");
    expect(a.summary.length).toBeGreaterThan(0);
  });

  it("analyses an email lookup", () => {
    const data = { email: "ada@example.com", analysis: { domain: "example.com", providerName: "Example", isDisposable: false, isRoleAddress: false }, emailrep: { ok: false } } as unknown as EmailLookupResponse;
    expect(analyzeLookup({ kind: "email", data }).subject).toBe("ada@example.com");
  });

  it("analyses a username lookup", () => {
    const data = { username: "ada", found: 0, identity: { names: [], locations: [], avatars: [], bios: [] } } as unknown as UsernameLookupResponse;
    expect(analyzeLookup({ kind: "username", data }).subject).toBe("ada");
  });

  it("analyses an ip lookup", () => {
    const data = { input: "8.8.8.8", ip: null } as unknown as IpLookupResponse;
    const a = analyzeLookup({ kind: "ip", data });
    expect(a.subject).toBe("8.8.8.8");
    expect(a.signals).toEqual([]);
  });

  it("analyses a domain lookup", () => {
    const data = { domain: "example.com", emailSecurity: { hasMx: false, hasDmarc: false }, http: null, dnssec: null } as unknown as DomainLookupResponse;
    expect(analyzeLookup({ kind: "domain", data }).subject).toBe("example.com");
  });

  it("analyses a wallet lookup with no anomalies", () => {
    const data = { input: "0xabc", facts: null } as unknown as WalletLookupResponse;
    const a = analyzeLookup({ kind: "wallet", data });
    expect(a.subject).toBe("0xabc");
    expect(a.anomalies).toEqual([]);
  });

  it("analyses a hash lookup with no anomalies", () => {
    const data = { input: "deadbeef", facts: null } as unknown as HashLookupResponse;
    const a = analyzeLookup({ kind: "hash", data });
    expect(a.subject).toBe("deadbeef");
    expect(a.anomalies).toEqual([]);
  });

  it("fuses signals, risk and anomalies for a badly-exposed email", () => {
    const data = {
      email: "victim@example.com",
      analysis: { domain: "example.com", providerName: "Example", isDisposable: false, isRoleAddress: false },
      emailrep: { ok: false },
      breachAggregate: {
        breaches: [], total: 5, sourcesReporting: ["XposedOrNot", "LeakCheck"], sourcesAnswered: ["XposedOrNot", "LeakCheck"],
        withPassword: 3, verified: 1, dataClasses: [], firstBreach: null, lastBreach: null, timeline: [], enrichedCount: 0, passwordFieldsSeen: true,
      },
      credentialExposure: { distinctPasswords: 4, pairs: 9, capped: false, samples: [], passwordBreaches: 3, stealerLogs: 2, stealerPasswords: 5, exposed: true, reuse: "likely" },
    } as unknown as EmailLookupResponse;

    const a = analyzeLookup({ kind: "email", data });
    expect(a.risk.band === "high" || a.risk.band === "critical").toBe(true);
    expect(a.anomalies.map((x) => x.id)).toEqual(expect.arrayContaining(["combo.stealer_breach", "combo.reuse_plaintext"]));
    expect(a.summary.some((l) => l.includes("victim@example.com"))).toBe(true);
    // explainability: every factor cites evidence
    expect(a.risk.factors.every((f) => f.evidence.length > 0)).toBe(true);
  });
});
